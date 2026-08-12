import { createRouter, createWebHashHistory } from 'vue-router'
import LayoutDefault from '@/layout/default.vue'
import TalkingHeadDesk from '@/views/TalkingHeadDesk/index.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: LayoutDefault,
      children: [
        {
          path: '',
          component: TalkingHeadDesk,
        },
      ],
    },
  ],
})

export default router
