#!/usr/bin/env node
// Generate a REALISTIC multi-module Spring Boot codebase (fat services with real logic,
// validations, state machines, exceptions, inter-bean deps) to benchmark deep-dive queries
// where files are large — closer to production code than the getter-only bigdemo.
// Usage: node engine/tools/gen-realdemo.mjs [outDir] [modules] [domainsPerModule]
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const out = process.argv[2] || join(dirname(new URL(import.meta.url).pathname), '..', '..', 'realdemo');
const MODULES = Number(process.argv[3] || 3);
const DOMAINS = Number(process.argv[4] || 40);

if (existsSync(out)) rmSync(out, { recursive: true });
const W = (p, c) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

W(join(out, 'pom.xml'),
  `<project><modelVersion>4.0.0</modelVersion><groupId>com.real</groupId>` +
  `<artifactId>real-parent</artifactId><version>1.0.0</version><packaging>pom</packaging><modules>` +
  Array.from({ length: MODULES }, (_, m) => `<module>mod${m}</module>`).join('') +
  `</modules></project>\n`);

let files = 0;
for (let m = 0; m < MODULES; m++) {
  const mod = `mod${m}`;
  W(join(out, mod, 'pom.xml'),
    `<project><modelVersion>4.0.0</modelVersion><parent><groupId>com.real</groupId>` +
    `<artifactId>real-parent</artifactId><version>1.0.0</version></parent><artifactId>${mod}</artifactId></project>\n`);

  for (let d = 0; d < DOMAINS; d++) {
    const D = cap(`r${m}_${d}`);
    const pkg = `com.real.${mod}.dom${d}`;
    const dir = join(out, mod, 'src/main/java', ...pkg.split('.'));

    W(join(dir, `${D}Status.java`),
      `package ${pkg};\n\npublic enum ${D}Status { PENDING, APPROVED, REJECTED, CANCELLED }\n`);

    W(join(dir, `${D}.java`),
      `package ${pkg};\n\nimport jakarta.persistence.*;\nimport java.math.BigDecimal;\nimport java.time.Instant;\nimport java.util.List;\n\n` +
      `@Entity\n@Table(name = "${D.toLowerCase()}")\npublic class ${D} {\n\n` +
      `    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)\n    private Long id;\n\n` +
      `    @Column(unique = true, nullable = false, length = 64)\n    private String code;\n\n` +
      `    @Column(nullable = false)\n    private BigDecimal amount;\n\n` +
      `    @Enumerated(EnumType.STRING)\n    private ${D}Status status;\n\n` +
      `    private String label;\n    private String owner;\n    private Instant createdAt;\n    private Instant updatedAt;\n\n` +
      `    @OneToMany(mappedBy = "parent", cascade = CascadeType.ALL)\n    private List<${D}Line> lines;\n\n` +
      `    public Long getId() { return id; }\n    public String getCode() { return code; }\n    public void setCode(String code) { this.code = code; }\n` +
      `    public BigDecimal getAmount() { return amount; }\n    public void setAmount(BigDecimal a) { this.amount = a; }\n` +
      `    public ${D}Status getStatus() { return status; }\n    public void setStatus(${D}Status s) { this.status = s; }\n` +
      `    public String getLabel() { return label; }\n    public void setLabel(String l) { this.label = l; }\n` +
      `    public String getOwner() { return owner; }\n    public void setOwner(String o) { this.owner = o; }\n` +
      `    public Instant getCreatedAt() { return createdAt; }\n    public void setCreatedAt(Instant c) { this.createdAt = c; }\n` +
      `    public void setUpdatedAt(Instant u) { this.updatedAt = u; }\n    public List<${D}Line> getLines() { return lines; }\n}\n`);

    W(join(dir, `${D}Line.java`),
      `package ${pkg};\n\nimport jakarta.persistence.*;\nimport java.math.BigDecimal;\n\n@Entity\npublic class ${D}Line {\n` +
      `    @Id @GeneratedValue private Long id;\n    @ManyToOne(fetch = FetchType.LAZY) private ${D} parent;\n` +
      `    private String sku;\n    private int quantity;\n    private BigDecimal unitPrice;\n\n` +
      `    public Long getId() { return id; }\n    public int getQuantity() { return quantity; }\n    public BigDecimal getUnitPrice() { return unitPrice; }\n}\n`);

    W(join(dir, `${D}Repository.java`),
      `package ${pkg};\n\nimport org.springframework.data.jpa.repository.JpaRepository;\nimport org.springframework.data.domain.*;\nimport java.util.Optional;\nimport java.util.List;\n\n` +
      `public interface ${D}Repository extends JpaRepository<${D}, Long> {\n` +
      `    Optional<${D}> findByCode(String code);\n    boolean existsByCode(String code);\n` +
      `    List<${D}> findByOwner(String owner);\n    Page<${D}> findByStatus(${D}Status status, Pageable pageable);\n}\n`);

    W(join(dir, `${D}Request.java`),
      `package ${pkg};\n\nimport jakarta.validation.constraints.*;\nimport java.math.BigDecimal;\n\npublic class ${D}Request {\n` +
      `    @NotBlank @Size(max = 64)\n    private String code;\n` +
      `    @NotNull @DecimalMin("0.01")\n    private BigDecimal amount;\n` +
      `    @Size(max = 255)\n    private String label;\n    @NotBlank private String owner;\n\n` +
      `    public String getCode() { return code; }\n    public BigDecimal getAmount() { return amount; }\n` +
      `    public String getLabel() { return label; }\n    public String getOwner() { return owner; }\n}\n`);

    W(join(dir, `${D}Response.java`),
      `package ${pkg};\n\nimport java.math.BigDecimal;\n\npublic class ${D}Response {\n` +
      `    private Long id;\n    private String code;\n    private BigDecimal amount;\n    private String status;\n\n` +
      `    public ${D}Response(Long id, String code, BigDecimal amount, String status) {\n` +
      `        this.id = id; this.code = code; this.amount = amount; this.status = status;\n    }\n` +
      `    public Long getId() { return id; }\n    public String getCode() { return code; }\n}\n`);

    W(join(dir, `${D}Mapper.java`),
      `package ${pkg};\n\nimport org.springframework.stereotype.Component;\n\n@Component\npublic class ${D}Mapper {\n` +
      `    public ${D} toEntity(${D}Request req) {\n        ${D} e = new ${D}();\n        e.setCode(req.getCode());\n` +
      `        e.setAmount(req.getAmount());\n        e.setLabel(req.getLabel());\n        e.setOwner(req.getOwner());\n        return e;\n    }\n` +
      `    public ${D}Response toResponse(${D} e) {\n        return new ${D}Response(e.getId(), e.getCode(), e.getAmount(),\n` +
      `            e.getStatus() == null ? null : e.getStatus().name());\n    }\n}\n`);

    W(join(dir, `${D}NotFoundException.java`),
      `package ${pkg};\n\npublic class ${D}NotFoundException extends RuntimeException {\n` +
      `    public ${D}NotFoundException(Long id) { super("${D} not found: " + id); }\n}\n`);

    W(join(dir, `${D}ValidationException.java`),
      `package ${pkg};\n\npublic class ${D}ValidationException extends RuntimeException {\n` +
      `    public ${D}ValidationException(String message) { super(message); }\n}\n`);

    // Fat service with real-ish logic, branching, a state machine, logging (braces in strings), comments
    W(join(dir, `${D}Service.java`),
      `package ${pkg};\n\nimport org.springframework.stereotype.Service;\nimport org.springframework.transaction.annotation.Transactional;\n` +
      `import org.springframework.data.domain.*;\nimport org.slf4j.*;\nimport java.math.BigDecimal;\nimport java.time.Instant;\nimport java.util.List;\n\n` +
      `/**\n * Application service for the ${D} domain.\n * Handles the full lifecycle: creation, update, lookup,\n * search and the approval state machine { PENDING -> APPROVED | REJECTED }.\n */\n` +
      `@Service\n@Transactional\npublic class ${D}Service {\n\n` +
      `    private static final Logger log = LoggerFactory.getLogger(${D}Service.class);\n\n` +
      `    private final ${D}Repository repository;\n    private final ${D}Mapper mapper;\n\n` +
      `    public ${D}Service(${D}Repository repository, ${D}Mapper mapper) {\n        this.repository = repository;\n        this.mapper = mapper;\n    }\n\n` +
      `    public ${D}Response create(${D}Request request) {\n        validate(request);\n` +
      `        if (repository.existsByCode(request.getCode())) {\n            throw new ${D}ValidationException("duplicate code: " + request.getCode());\n        }\n` +
      `        ${D} entity = mapper.toEntity(request);\n        entity.setStatus(${D}Status.PENDING);\n        entity.setCreatedAt(Instant.now());\n` +
      `        ${D} saved = repository.save(entity);\n        log.info("created ${D} id={} code={}", saved.getId(), saved.getCode());\n        return mapper.toResponse(saved);\n    }\n\n` +
      `    @Transactional(readOnly = true)\n    public ${D}Response get(Long id) {\n        ${D} e = repository.findById(id).orElseThrow(() -> new ${D}NotFoundException(id));\n        return mapper.toResponse(e);\n    }\n\n` +
      `    public ${D}Response update(Long id, ${D}Request request) {\n        validate(request);\n` +
      `        ${D} e = repository.findById(id).orElseThrow(() -> new ${D}NotFoundException(id));\n` +
      `        if (e.getStatus() == ${D}Status.APPROVED) {\n            throw new ${D}ValidationException("cannot modify an approved ${D}");\n        }\n` +
      `        e.setAmount(request.getAmount());\n        e.setLabel(request.getLabel());\n        e.setUpdatedAt(Instant.now());\n        return mapper.toResponse(repository.save(e));\n    }\n\n` +
      `    public void delete(Long id) {\n        if (!repository.existsById(id)) {\n            throw new ${D}NotFoundException(id);\n        }\n        repository.deleteById(id);\n        log.info("deleted ${D} id={}", id);\n    }\n\n` +
      `    @Transactional(readOnly = true)\n    public Page<${D}Response> search(String owner, ${D}Status status, Pageable pageable) {\n` +
      `        Page<${D}> page = status != null\n            ? repository.findByStatus(status, pageable)\n            : repository.findAll(pageable);\n        return page.map(mapper::toResponse);\n    }\n\n` +
      `    public ${D}Response approve(Long id) {\n        ${D} e = repository.findById(id).orElseThrow(() -> new ${D}NotFoundException(id));\n` +
      `        validateTransition(e.getStatus(), ${D}Status.APPROVED);\n        e.setStatus(${D}Status.APPROVED);\n        e.setUpdatedAt(Instant.now());\n` +
      `        log.info("approved ${D} id={}", id);\n        return mapper.toResponse(repository.save(e));\n    }\n\n` +
      `    public ${D}Response reject(Long id, String reason) {\n        ${D} e = repository.findById(id).orElseThrow(() -> new ${D}NotFoundException(id));\n` +
      `        validateTransition(e.getStatus(), ${D}Status.REJECTED);\n        e.setStatus(${D}Status.REJECTED);\n        log.info("rejected ${D} id={} reason='{}'", id, reason);\n` +
      `        return mapper.toResponse(repository.save(e));\n    }\n\n` +
      `    private void validate(${D}Request request) {\n        if (request.getAmount() == null || request.getAmount().compareTo(BigDecimal.ZERO) <= 0) {\n` +
      `            throw new ${D}ValidationException("amount must be strictly positive");\n        }\n` +
      `        if (request.getCode() == null || request.getCode().isBlank()) {\n            throw new ${D}ValidationException("code is required");\n        }\n    }\n\n` +
      `    private void validateTransition(${D}Status from, ${D}Status to) {\n        if (from != ${D}Status.PENDING) {\n` +
      `            throw new ${D}ValidationException("invalid transition from " + from + " to " + to);\n        }\n    }\n}\n`);

    W(join(dir, `${D}Controller.java`),
      `package ${pkg};\n\nimport org.springframework.web.bind.annotation.*;\nimport org.springframework.data.domain.*;\nimport jakarta.validation.Valid;\n\n` +
      `@RestController\n@RequestMapping("/api/${D.toLowerCase()}")\npublic class ${D}Controller {\n\n` +
      `    private final ${D}Service service;\n\n    public ${D}Controller(${D}Service service) {\n        this.service = service;\n    }\n\n` +
      `    @PostMapping\n    public ${D}Response create(@Valid @RequestBody ${D}Request request) {\n        return service.create(request);\n    }\n\n` +
      `    @GetMapping("/{id}")\n    public ${D}Response get(@PathVariable Long id) {\n        return service.get(id);\n    }\n\n` +
      `    @PutMapping("/{id}")\n    public ${D}Response update(@PathVariable Long id, @Valid @RequestBody ${D}Request request) {\n        return service.update(id, request);\n    }\n\n` +
      `    @DeleteMapping("/{id}")\n    public void delete(@PathVariable Long id) {\n        service.delete(id);\n    }\n\n` +
      `    @GetMapping\n    public Page<${D}Response> search(@RequestParam(required = false) String owner,\n` +
      `            @RequestParam(required = false) ${D}Status status, Pageable pageable) {\n        return service.search(owner, status, pageable);\n    }\n\n` +
      `    @PostMapping("/{id}/approve")\n    public ${D}Response approve(@PathVariable Long id) {\n        return service.approve(id);\n    }\n\n` +
      `    @PostMapping("/{id}/reject")\n    public ${D}Response reject(@PathVariable Long id, @RequestParam String reason) {\n        return service.reject(id, reason);\n    }\n}\n`);

    files += 11;
  }
}
console.log(`realdemo généré: ${MODULES} modules, ${MODULES * DOMAINS} domaines, ${files} fichiers .java → ${out}`);
