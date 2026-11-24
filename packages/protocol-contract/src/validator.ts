export type SchemaRule = {
  $schema?: string;
  $id?: string;
  title?: string;
  $defs?: Record<string, SchemaRule>;
  $ref?: string;
  const?: unknown;
  enum?: unknown[];
  type?: string | string[];
  required?: string[];
  properties?: Record<string, SchemaRule>;
  additionalProperties?: boolean | SchemaRule;
  anyOf?: SchemaRule[];
  oneOf?: SchemaRule[];
  items?: SchemaRule;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
};

function typeMatches(value: unknown, type: string): boolean {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return false;
}

/** 只实现本 spec 使用的 JSON Schema 子集；未知关键字报错，不静默放行。 */
export function validateJson(value: unknown, rule: SchemaRule, root: SchemaRule, at = '$'): string[] {
  if (!rule || Object.keys(rule).length === 0) return [];
  if (rule.$ref) {
    const name = rule.$ref.replace(/^#\/?\$defs\//, '');
    const target = root.$defs?.[name];
    if (!target) return [`${at}: unknown ref ${rule.$ref}`];
    return validateJson(value, target, root, at);
  }
  const errors: string[] = [];
  const known = new Set(['$schema','$id','title','$defs','$ref','const','enum','type','required','properties','additionalProperties','anyOf','oneOf','items','minItems','maxItems','uniqueItems','minLength','maxLength','pattern','minimum','maximum']);
  for (const key of Object.keys(rule)) if (!known.has(key)) errors.push(`${at}: unsupported schema keyword ${key}`);
  if (rule.const !== undefined && value !== rule.const) errors.push(`${at}: expected const ${String(rule.const)}`);
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${at}: expected enum ${rule.enum.join('|')}`);
  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some((type) => typeMatches(value, type))) {
      errors.push(`${at}: expected type ${types.join('|')}`);
      return errors;
    }
  }
  if (rule.anyOf) {
    const matched = rule.anyOf.some((branch) => validateJson(value, branch, root, at).length === 0);
    if (!matched) errors.push(`${at}: no anyOf branch matched`);
  }
  if (rule.oneOf) {
    const matched = rule.oneOf.filter((branch) => validateJson(value, branch, root, at).length === 0).length;
    if (matched !== 1) errors.push(`${at}: expected exactly one oneOf branch`);
  }
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (rule.minLength !== undefined && length < rule.minLength) errors.push(`${at}: string too short`);
    if (rule.maxLength !== undefined && length > rule.maxLength) errors.push(`${at}: string too long`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${at}: pattern ${rule.pattern} mismatch`);
  }
  if (typeof value === 'number') {
    if (rule.minimum !== undefined && value < rule.minimum) errors.push(`${at}: below minimum`);
    if (rule.maximum !== undefined && value > rule.maximum) errors.push(`${at}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) errors.push(`${at}: too few items`);
    if (rule.maxItems !== undefined && value.length > rule.maxItems) errors.push(`${at}: too many items`);
    if (rule.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${at}: items not unique`);
    if (rule.items) value.forEach((item, index) => errors.push(...validateJson(item, rule.items!, root, `${at}[${index}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of rule.required || []) if (!Object.hasOwn(value, key)) errors.push(`${at}: missing ${key}`);
    const properties = rule.properties || {};
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) errors.push(...validateJson(item, properties[key], root, `${at}.${key}`));
      else if (rule.additionalProperties === false) errors.push(`${at}: extra field ${key}`);
      else if (rule.additionalProperties && typeof rule.additionalProperties === 'object') errors.push(...validateJson(item, rule.additionalProperties, root, `${at}.${key}`));
    }
  }
  return errors;
}
