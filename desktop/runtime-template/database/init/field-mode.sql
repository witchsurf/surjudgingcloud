INSERT INTO public.app_deployment_config (id, deployment_mode, provisioned_at, cloud_test_activation_enabled)
VALUES (true, 'field', now(), false)
ON CONFLICT (id) DO UPDATE SET
  deployment_mode = EXCLUDED.deployment_mode,
  provisioned_at = now(),
  cloud_test_activation_enabled = EXCLUDED.cloud_test_activation_enabled;

INSERT INTO public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
VALUES (true, '__SURFJUDGING_SCHEMA_VERSION__', 'SurfJudging Field installer', now())
ON CONFLICT (id) DO UPDATE SET
  schema_version = EXCLUDED.schema_version,
  schema_label = EXCLUDED.schema_label,
  updated_at = now();
