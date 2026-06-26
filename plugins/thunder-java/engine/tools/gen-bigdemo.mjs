#!/usr/bin/env node
// Generate a large synthetic multi-module Spring Boot codebase to benchmark the engine.
// Usage: node engine/tools/gen-bigdemo.mjs [outDir] [modules] [domainsPerModule]
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const out = process.argv[2] || join(dirname(new URL(import.meta.url).pathname), '..', '..', 'bigdemo');
const MODULES = Number(process.argv[3] || 8);
const DOMAINS = Number(process.argv[4] || 80);

if (existsSync(out)) rmSync(out, { recursive: true });
const W = (p, c) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

W(join(out, 'pom.xml'),
  `<project><modelVersion>4.0.0</modelVersion><groupId>com.big</groupId>` +
  `<artifactId>big-parent</artifactId><version>1.0.0</version><packaging>pom</packaging><modules>` +
  Array.from({ length: MODULES }, (_, m) => `<module>mod${m}</module>`).join('') +
  `</modules></project>\n`);

let files = 0;
for (let m = 0; m < MODULES; m++) {
  const mod = `mod${m}`;
  W(join(out, mod, 'pom.xml'),
    `<project><modelVersion>4.0.0</modelVersion><parent><groupId>com.big</groupId>` +
    `<artifactId>big-parent</artifactId><version>1.0.0</version></parent><artifactId>${mod}</artifactId></project>\n`);

  for (let d = 0; d < DOMAINS; d++) {
    const D = cap(`dom${m}_${d}`);
    const pkg = `com.big.${mod}.dom${d}`;
    const dir = join(out, mod, 'src/main/java', ...pkg.split('.'));

    W(join(dir, `${D}.java`),
      `package ${pkg};\nimport jakarta.persistence.*;\nimport java.math.BigDecimal;\nimport java.util.List;\n\n` +
      `@Entity\n@Table(name = "${D.toLowerCase()}")\npublic class ${D} {\n` +
      `    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)\n    private Long id;\n` +
      `    @Column(unique = true, nullable = false)\n    private String code;\n` +
      `    private BigDecimal amount;\n    private String status;\n` +
      `    @OneToMany(mappedBy = "parent")\n    private List<${D}Line> lines;\n` +
      `    public Long getId() { return id; }\n    public String getCode() { return code; }\n` +
      `    public void setCode(String code) { this.code = code; }\n` +
      `    public BigDecimal getAmount() { return amount; }\n    public void setAmount(BigDecimal a) { this.amount = a; }\n}\n`);

    W(join(dir, `${D}Line.java`),
      `package ${pkg};\nimport jakarta.persistence.*;\n\n@Entity\npublic class ${D}Line {\n` +
      `    @Id @GeneratedValue private Long id;\n    @ManyToOne private ${D} parent;\n    private int qty;\n` +
      `    public Long getId() { return id; }\n    public int getQty() { return qty; }\n}\n`);

    W(join(dir, `${D}Repository.java`),
      `package ${pkg};\nimport org.springframework.data.jpa.repository.JpaRepository;\nimport java.util.Optional;\n\n` +
      `public interface ${D}Repository extends JpaRepository<${D}, Long> {\n` +
      `    Optional<${D}> findByCode(String code);\n    boolean existsByCode(String code);\n}\n`);

    W(join(dir, `${D}Dto.java`),
      `package ${pkg};\nimport jakarta.validation.constraints.*;\n\npublic class ${D}Dto {\n` +
      `    @NotBlank private String code;\n    @Min(1) private int qty;\n    private java.math.BigDecimal amount;\n` +
      `    public String getCode() { return code; }\n    public int getQty() { return qty; }\n}\n`);

    W(join(dir, `${D}Service.java`),
      `package ${pkg};\nimport org.springframework.stereotype.Service;\nimport org.springframework.transaction.annotation.Transactional;\nimport java.math.BigDecimal;\n\n` +
      `/* Service ${D} — piège lexer: accolade } dans commentaire { ok */\n@Service\npublic class ${D}Service {\n` +
      `    private final ${D}Repository repository;\n` +
      `    public ${D}Service(${D}Repository repository) { this.repository = repository; }\n` +
      `    @Transactional\n    public ${D} create(${D}Dto dto) {\n` +
      `        if (repository.existsByCode(dto.getCode())) {\n` +
      `            String msg = "Code déjà pris {code}: " + dto.getCode();\n            throw new IllegalStateException(msg);\n        }\n` +
      `        ${D} e = new ${D}();\n        e.setCode(dto.getCode());\n        return repository.save(e);\n    }\n` +
      `    public String help() {\n        return """\n            ${D} {\n              code: requis\n            }\n            """;\n    }\n}\n`);

    W(join(dir, `${D}Controller.java`),
      `package ${pkg};\nimport org.springframework.web.bind.annotation.*;\n\n` +
      `@RestController\n@RequestMapping("/${D.toLowerCase()}")\npublic class ${D}Controller {\n` +
      `    private final ${D}Service service;\n` +
      `    public ${D}Controller(${D}Service service) { this.service = service; }\n` +
      `    @PostMapping\n    public ${D} create(@RequestBody ${D}Dto dto) { return service.create(dto); }\n` +
      `    @GetMapping("/{code}")\n    public ${D} get(@PathVariable String code) { return service.findByCode(code); }\n` +
      `    @DeleteMapping("/{id}")\n    public void remove(@PathVariable Long id) { }\n}\n`);

    files += 6;
  }
}
console.log(`bigdemo généré: ${MODULES} modules, ${MODULES * DOMAINS} domaines, ${files} fichiers .java → ${out}`);
