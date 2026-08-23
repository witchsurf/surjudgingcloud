# P3.7B Builder — Authoritative Source Freeze Resolution

## Forensic comparison

Range audited: `17ed8b0..ec8a4f2`.

| Commit | Files | Classification | Runtime impact |
|---|---|---|---|
| `b56cfa4` | `P2_7_86_FULL_FIELD_SYSTEM_CERTIFICATION.md` | E — certification documentation | none |
| `ec8a4f2` | `P2_7_75_PERMANENT_DB_REGRESSION_CERTIFICATION.md`, `backend/supabase/tests/p2_7_75_permanent_db_regression.sql` | C/E — permanent DB regression test and certification record | none |

The complete diff contains only these three files and 183 inserted lines.
No frontend source, runtime code, migration, schema, release tooling, or
sporting logic changed after `17ed8b0`.

## Identity resolution

```text
AUTHORITATIVE REPO REVISION = ec8a4f28710bf7cc75028bfd5a21397648c20842
AUTHORITATIVE RUNTIME SOURCE REVISION = 17ed8b0799a9a0298b7d6b7812f57403432b093d
AUTHORITATIVE FRONTEND RELEASE = surfjudging-2026.08.14-p2.7.78-lineage-fix
AUTHORITATIVE SCHEMA = 20260814220000_fix_exhaustive_ranking_lineage_division
AUTHORITATIVE MIGRATION DIGEST = b0292cf9ec290985ab83a69571eb53df4fe7165198038c10e72813ba22add97e
```

```text
FRONTEND CHANGED AFTER 17ed8b = NO
RUNTIME CHANGED AFTER 17ed8b = NO
MIGRATIONS CHANGED AFTER 17ed8b = NO
SPORTING LOGIC CHANGED AFTER 17ed8b = NO
FINAL TESTS REQUIRE ec8a4f2 = YES
```

The repository identity is therefore newer than the certified runtime
identity by design. The final certification test must remain available to the
builder, while the shipped frontend/runtime payload remains frozen at `17ed8b0`.

## Selected source model

**MODEL B — builder/tooling and permanent tests from `ec8a4f2`; runtime and
frontend payload identity frozen to certified `17ed8b0`.**

Use a clean isolated worktree at `ec8a4f2` for builder tooling, and copy only
the certified runtime/frontend inputs from the verified `17ed8b0` tree. Never
build from the current dirty worktree and do not destructively clean it.

## Runtime inputs (not acquired or installed in this phase)

```text
Docker CLI 29.0.1 observed builder-input SHA256:
e64b960996f1f6c174d07f727855dc49e18b958775e3ad03c1b93a4b5e62f736
Lima 2.1.1 verified SHA256:
2dc5b10aa3a4f26d08c1f3fe83e37e01f85a7d9db0d1d5cb6985b18af96ab07d
Colima 0.10.3 observed builder-input SHA256:
3082737fe8a98afda11cba7d9a20b6e56fe80c6153464beda04bec630758770b
```

These are SurfJudging builder-input hashes, not vendor attestations.

## Minisign decision

Use pinned minisign `0.11` from the official `jedisct1/minisign` release,
acquired as a versioned release asset or reproducibly built from the official
source. Before use, verify its official release signature/checksum and record
the exact macOS x86_64 asset hash. No keypair is created in this resolution
phase. Official project documentation describes Ed25519 signatures and
verification workflows ([minisign](https://github.com/jedisct1/minisign)).

## Final decision

```text
SELECTED SOURCE MODEL = MODEL B
BUILDER WORKTREE = isolated clean worktree at ec8a4f2
RUNTIME PAYLOAD SOURCE = certified 17ed8b0 identity
FINAL TESTS INCLUDED = ec8a4f2 permanent regression tests
INSTALL AUTHORIZED NOW = NO
```

No build, checkout, installation, target mutation, Cloud change, or Field
change was performed.
