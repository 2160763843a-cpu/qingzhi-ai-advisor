import type { Faq, Product, TestDialogue } from '../types/data'

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`请求失败: ${url} (HTTP ${res.status})`)
  }
  return res.json() as Promise<T>
}

export function fetchProducts(): Promise<Product[]> {
  return getJson<Product[]>('/api/products')
}

export function fetchFaqs(): Promise<Faq[]> {
  return getJson<Faq[]>('/api/faqs')
}

export function fetchTestDialogues(): Promise<TestDialogue[]> {
  return getJson<TestDialogue[]>('/api/test-dialogues')
}
