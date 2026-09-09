/// <reference types="vite/client" />

interface WechatSharePayload {
  title: string
  desc?: string
  link: string
  imgUrl: string
}

interface WechatSdk {
  config(options: { debug: boolean; appId: string; timestamp: number; nonceStr: string; signature: string; jsApiList: string[] }): void
  ready(callback: () => void): void
  error(callback: (error: unknown) => void): void
  updateAppMessageShareData(payload: WechatSharePayload): void
  updateTimelineShareData(payload: Omit<WechatSharePayload, 'desc'>): void
}

interface Window {
  wx?: WechatSdk
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
