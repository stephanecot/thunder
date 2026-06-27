#!/usr/bin/env node
// Generate a realistic FastAPI app (feature packages with Pydantic models, fat services, routers)
// to benchmark inline answering. Usage: node engine/tools/gen-pydemo.mjs [outDir] [features]
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const out = process.argv[2] || join(dirname(new URL(import.meta.url).pathname), '..', '..', 'pydemo');
const FEATURES = Number(process.argv[3] || 40);
if (existsSync(out)) rmSync(out, { recursive: true });
const W = (p, c) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'pyproject.toml'), '[project]\nname = "bigshop"\nversion = "0.1.0"\n');
W(join(out, 'bigshop/__init__.py'), '');

for (let i = 0; i < FEATURES; i++) {
  const f = `f${i}`; const F = cap(f);
  const dir = join(out, 'bigshop', f);
  W(join(dir, '__init__.py'), '');

  W(join(dir, 'models.py'),
    `from datetime import datetime\nfrom decimal import Decimal\nfrom pydantic import BaseModel, Field, validator\n\n` +
    `class ${F}(BaseModel):\n    id: int\n    code: str = Field(max_length=64)\n    amount: Decimal\n    status: str = "PENDING"\n    owner: str\n    created_at: datetime | None = None\n\n` +
    `class ${F}Create(BaseModel):\n    code: str = Field(max_length=64)\n    amount: Decimal\n    owner: str\n\n    @validator("amount")\n    def amount_positive(cls, v):\n        if v <= 0:\n            raise ValueError("amount must be strictly positive")\n        return v\n\n` +
    `class ${F}Update(BaseModel):\n    amount: Decimal | None = None\n    status: str | None = None\n`);

  W(join(dir, 'service.py'),
    `from .models import ${F}, ${F}Create, ${F}Update\n\n\nclass ${F}NotFound(Exception):\n    pass\n\n\n` +
    `class ${F}Service:\n    """Application service for the ${F} domain (create, update, approval, search)."""\n\n` +
    `    def __init__(self, repo):\n        self.repo = repo\n\n` +
    `    def create(self, data: ${F}Create) -> ${F}:\n        if self.repo.exists(code=data.code):\n            raise ValueError("duplicate code: " + data.code)\n        item = ${F}(id=0, code=data.code, amount=data.amount, owner=data.owner)\n        return self.repo.save(item)\n\n` +
    `    def get(self, item_id: int) -> ${F}:\n        item = self.repo.find(item_id)\n        if item is None:\n            raise ${F}NotFound(item_id)\n        return item\n\n` +
    `    def update(self, item_id: int, data: ${F}Update) -> ${F}:\n        item = self.get(item_id)\n        if item.status == "APPROVED":\n            raise ValueError("cannot modify an approved ${F}")\n        if data.amount is not None:\n            item.amount = data.amount\n        return self.repo.save(item)\n\n` +
    `    def delete(self, item_id: int) -> None:\n        self.get(item_id)\n        self.repo.delete(item_id)\n\n` +
    `    def search(self, owner: str | None = None, status: str | None = None) -> list[${F}]:\n        rows = self.repo.all()\n        if owner:\n            rows = [r for r in rows if r.owner == owner]\n        if status:\n            rows = [r for r in rows if r.status == status]\n        return rows\n\n` +
    `    def approve(self, item_id: int) -> ${F}:\n        item = self.get(item_id)\n        self._validate_transition(item.status, "APPROVED")\n        item.status = "APPROVED"\n        return self.repo.save(item)\n\n` +
    `    def _validate_transition(self, frm: str, to: str) -> None:\n        if frm != "PENDING":\n            raise ValueError("invalid transition from " + frm)\n`);

  W(join(dir, 'routes.py'),
    `from fastapi import APIRouter, Depends, HTTPException\n\nfrom .models import ${F}, ${F}Create, ${F}Update\nfrom .service import ${F}Service, ${F}NotFound\n\n` +
    `router = APIRouter(tags=["${f}"])\n\n\ndef get_${f}_service() -> ${F}Service:\n    return ${F}Service(repo=None)\n\n\n` +
    `@router.post("/${f}", response_model=${F}, status_code=201)\ndef create_${f}(data: ${F}Create, svc: ${F}Service = Depends(get_${f}_service)) -> ${F}:\n    return svc.create(data)\n\n\n` +
    `@router.get("/${f}/{item_id}", response_model=${F})\ndef get_${f}(item_id: int, svc: ${F}Service = Depends(get_${f}_service)) -> ${F}:\n    try:\n        return svc.get(item_id)\n    except ${F}NotFound:\n        raise HTTPException(status_code=404)\n\n\n` +
    `@router.put("/${f}/{item_id}", response_model=${F})\ndef update_${f}(item_id: int, data: ${F}Update, svc: ${F}Service = Depends(get_${f}_service)) -> ${F}:\n    return svc.update(item_id, data)\n\n\n` +
    `@router.delete("/${f}/{item_id}", status_code=204)\ndef delete_${f}(item_id: int, svc: ${F}Service = Depends(get_${f}_service)) -> None:\n    svc.delete(item_id)\n\n\n` +
    `@router.get("/${f}", response_model=list[${F}])\ndef search_${f}(owner: str | None = None, svc: ${F}Service = Depends(get_${f}_service)) -> list[${F}]:\n    return svc.search(owner)\n\n\n` +
    `@router.post("/${f}/{item_id}/approve", response_model=${F})\ndef approve_${f}(item_id: int, svc: ${F}Service = Depends(get_${f}_service)) -> ${F}:\n    return svc.approve(item_id)\n`);
}
console.log(`pydemo: 1 project, ${FEATURES} feature packages, ${FEATURES * 4 + 2} files → ${out}`);
