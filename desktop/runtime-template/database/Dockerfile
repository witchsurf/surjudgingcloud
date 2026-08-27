ARG POSTGRES_IMAGE=supabase/postgres:15.1.0.147
FROM ${POSTGRES_IMAGE}

# These scripts execute only while Docker creates a new database volume.
# Existing competition volumes are never reinitialised by an application update.
COPY init/ /docker-entrypoint-initdb.d/surfjudging-field/
# The Supabase/PostgreSQL entrypoint only executes top-level .sql/.sh files.
# Keep the data files grouped, but expose one deterministic top-level launcher.
COPY init/zz-surfjudging-field.sh /docker-entrypoint-initdb.d/zz-surfjudging-field.sh
RUN chmod 0755 /docker-entrypoint-initdb.d/zz-surfjudging-field.sh \
  /docker-entrypoint-initdb.d/surfjudging-field/*.sh
