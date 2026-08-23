export function parseModelJson(text: string, context: string, finishReason?: string) {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(clean) } catch {
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    if (start >= 0 && end > start) try { return JSON.parse(clean.slice(start, end + 1)) } catch { /* report below */ }
    const summary = clean.replace(/\s+/g, ' ').slice(0, 240) || '空响应'
    const reason = finishReason === 'length' ? '，输出被截断' : ''
    throw new Error(`${context}返回的 JSON 无法解析${reason}。模型原始返回：${summary}`)
  }
}
