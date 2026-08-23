import i18next from 'i18next'
import { i18nCommonOptions } from '~/electron/i18n/common-options'
import en from '../../locales/en/common.json'
import zhCN from '../../locales/zh-CN/common.json'

const i18nInitialized = async () => {
  const locale = 'zh-CN'
  if (window.i18n) await window.i18n.changeLanguage(locale)
  return i18next.init({
    ...i18nCommonOptions,
    lng: locale,
    resources: {
      en: { common: en },
      'zh-CN': { common: zhCN },
    },
  })
}

export const i18n = i18next

export default i18nInitialized
