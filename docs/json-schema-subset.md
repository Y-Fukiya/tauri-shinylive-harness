# JSON Schema Subset

The harness uses a small local JSON Schema subset validator for bundled
configuration, clinical data pack metadata, and CDISC bridge mapping checks.
It is intentionally dependency-light and is not a full Draft 2020-12
implementation.

Supported keywords:

- `type`
- `required`
- `properties`
- `additionalProperties`
- `items`
- `enum`
- `const`
- `pattern`
- `minLength`
- `minItems`
- `uniqueItems`
- `minProperties`
- local `$ref` values that begin with `#/`

Schemas used by this repository must stay within this subset unless the
validator is replaced with a full JSON Schema implementation such as Ajv.
