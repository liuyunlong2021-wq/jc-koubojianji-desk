import { createRouter, createWebHashHistory } from 'vue-router'
import LayoutDefault from '@/layout/default.vue'
import TalkingHeadDesk from '@/views/TalkingHeadDesk/index.vue'
import FilmBreakdownDesk from '@/views/FilmBreakdownDesk/index.vue'

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
        {
          path: 'film-breakdown',
          component: FilmBreakdownDesk,
        },
      ],
    },
  ],
})

export default router
