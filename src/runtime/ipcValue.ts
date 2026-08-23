export function toIpcValue<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}
