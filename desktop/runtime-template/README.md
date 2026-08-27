# Runtime template

The installer assembler copies the frozen baseline and manifest-selected
migrations into `database/init/`. The custom PostgreSQL image executes them
only on a new Docker volume, then writes the authoritative `field` deployment
mode and schema marker. This directory is source-only: it never contains
competition data or accepted-runtime secrets.
