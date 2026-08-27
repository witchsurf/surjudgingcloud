ARG POSTGRES_IMAGE=supabase/postgres:15.1.0.147
FROM ${POSTGRES_IMAGE}

# These scripts execute only while Docker creates a new database volume.
# Existing competition volumes are never reinitialised by an application update.
COPY init/ /docker-entrypoint-initdb.d/surfjudging-field/
RUN chmod 0755 /docker-entrypoint-initdb.d/surfjudging-field/*.sh
