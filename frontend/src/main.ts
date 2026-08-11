import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

const router = createRouter({ history: createWebHashHistory(), routes: [
  { path: '/', redirect: '/archive' },
  { path: '/archive', component: App },
  { path: '/providers', component: App },
  { path: '/settings', component: App },
] })
createApp(App).use(createPinia()).use(router).mount('#app')
