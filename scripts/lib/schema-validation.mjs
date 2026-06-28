import { readFile } from "node:fs/promises";

const readSchema = async (schemaPath, timeoutMs = 5000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await readFile(schemaPath, { encoding: "utf8", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const typeOf = (value) => {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
};

const pointer = (path) => (path.length ? `/${path.map((item) => String(item).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}` : "");

const matchesType = (value, expected) => {
  const types = Array.isArray(expected) ? expected : [expected];
  return types.some((type) => {
    if (type === "integer") {
      return Number.isInteger(value);
    }
    return typeOf(value) === type;
  });
};

const resolveRef = (schema, rootSchema) => {
  if (!schema?.$ref || !String(schema.$ref).startsWith("#/")) {
    return schema;
  }
  return String(schema.$ref)
    .slice(2)
    .split("/")
    .reduce((current, segment) => current?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")], rootSchema) ?? schema;
};

const validateNode = (inputSchema, data, path, errors, rootSchema = inputSchema) => {
  const schema = resolveRef(inputSchema, rootSchema);
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return;
  }

  if (schema.type && !matchesType(data, schema.type)) {
    errors.push({
      instancePath: pointer(path),
      keyword: "type",
      message: `must be ${Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type}`,
      params: { type: schema.type },
    });
    return;
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push({
      instancePath: pointer(path),
      keyword: "enum",
      message: `must be one of ${schema.enum.join(", ")}`,
      params: { allowedValues: schema.enum },
    });
  }

  if (Object.prototype.hasOwnProperty.call(schema, "const") && data !== schema.const) {
    errors.push({
      instancePath: pointer(path),
      keyword: "const",
      message: `must be equal to constant ${JSON.stringify(schema.const)}`,
      params: { allowedValue: schema.const },
    });
  }

  if (typeof data === "string" && schema.pattern) {
    const expression = new RegExp(schema.pattern);
    if (!expression.test(data)) {
      errors.push({
        instancePath: pointer(path),
        keyword: "pattern",
        message: `must match pattern ${schema.pattern}`,
        params: { pattern: schema.pattern },
      });
    }
  }

  if (typeof data === "string" && schema.minLength !== undefined && data.length < schema.minLength) {
    errors.push({
      instancePath: pointer(path),
      keyword: "minLength",
      message: `must NOT have fewer than ${schema.minLength} characters`,
      params: { limit: schema.minLength },
    });
  }

  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({
        instancePath: pointer(path),
        keyword: "minItems",
        message: `must NOT have fewer than ${schema.minItems} items`,
        params: { limit: schema.minItems },
      });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const item of data) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          errors.push({
            instancePath: pointer(path),
            keyword: "uniqueItems",
            message: "must NOT have duplicate items",
            params: {},
          });
          break;
        }
        seen.add(key);
      }
    }
    if (schema.items) {
      data.forEach((item, index) => validateNode(schema.items, item, [...path, index], errors, rootSchema));
    }
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(data, required)) {
        errors.push({
          instancePath: pointer(path),
          keyword: "required",
          message: `must have required property ${required}`,
          params: { missingProperty: required },
        });
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        validateNode(childSchema, data[key], [...path, key], errors, rootSchema);
      }
    }
    if (schema.minProperties !== undefined && Object.keys(data).length < schema.minProperties) {
      errors.push({
        instancePath: pointer(path),
        keyword: "minProperties",
        message: `must NOT have fewer than ${schema.minProperties} properties`,
        params: { limit: schema.minProperties },
      });
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) {
          errors.push({
            instancePath: pointer(path),
            keyword: "additionalProperties",
            message: `must NOT have additional property ${key}`,
            params: { additionalProperty: key },
          });
        }
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const [key, value] of Object.entries(data)) {
        if (!known.has(key)) {
          validateNode(schema.additionalProperties, value, [...path, key], errors, rootSchema);
        }
      }
    }
  }
};

export const validateJsonSchema = async ({ schemaPath, data, label }) => {
  let schema;
  try {
    schema = JSON.parse(await readSchema(schemaPath));
  } catch (error) {
    return {
      ok: false,
      label,
      schemaPath,
      errors: [
        {
          instancePath: "",
          keyword: "schema-read",
          message: error?.name === "AbortError" ? "schema read timed out" : `schema read failed: ${error instanceof Error ? error.message : String(error)}`,
          params: { schemaPath },
        },
      ],
    };
  }
  const errors = [];
  validateNode(schema, data, [], errors, schema);
  return {
    ok: errors.length === 0,
    label,
    schemaPath,
    errors,
  };
};
