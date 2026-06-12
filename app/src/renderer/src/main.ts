import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { i18n, currentLocale } from './i18n'
import './styles.css'

document.documentElement.lang = currentLocale()
// platform class so the topbar can clear the native window chrome (mac traffic lights / PC overlay)
document.documentElement.classList.add(
  navigator.userAgent.includes('Macintosh') ? 'is-mac' : 'is-pc'
)
createApp(App).use(createPinia()).use(i18n).mount('#app')
