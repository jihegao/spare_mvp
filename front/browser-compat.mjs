export function installStructuredCloneFallback(target = globalThis) {
  if (typeof target.structuredClone !== "function") {
    target.structuredClone = (value) => {
      if (value == null) return value;
      return JSON.parse(JSON.stringify(value));
    };
  }
  const objectConstructor = target.Object || Object;
  if (typeof objectConstructor.hasOwn !== "function") {
    objectConstructor.hasOwn = (value, property) => Object.prototype.hasOwnProperty.call(value, property);
  }
  return target.structuredClone;
}

installStructuredCloneFallback();
