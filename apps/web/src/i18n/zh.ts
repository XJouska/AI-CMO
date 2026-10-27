// 界面文案集中在这里。首版只做中文界面；以后加英文版时新增 en.ts，保持同样的结构。
import { BRAND } from '@/brand'

export const zh = {
  app: {
    name: BRAND.name,
  },
  tabs: {
    assistant: '助手',
    leads: '商机',
    site: '官网',
    me: '我的',
    ariaLabel: '主导航',
  },
  assistant: {
    welcomeTitle: `你好，我是 ${BRAND.name}`,
    welcomeBody: `${BRAND.tagline}。我可以帮你：`,
    welcomeItems: ['整理企业档案和主营产品', '生成英文 B2B 官网', '每天寻找并筛选海外采购商', '撰写开发信并提醒跟进'],
    inputPlaceholder: '告诉我你想找什么样的客户',
    historyComingSoon: '历史会话即将上线',
    sendComingSoon: '对话功能即将上线',
  },
  leads: {
    title: '商机',
    emptyTitle: '暂无商机',
    emptyDesc: '完善企业档案并开启商机监控后，这里会展示每天筛选出的海外采购商。',
  },
  site: {
    title: '官网',
    emptyTitle: '还没有官网',
    emptyDesc: '和助手聊聊你的工厂和产品，即可生成一个英文 B2B 官网。',
    emptyAction: '去和助手聊聊',
  },
  me: {
    title: '我的',
    sectionAccount: '企业与团队',
    sectionPlan: '服务',
    profile: '企业档案',
    profileValue: '未完善',
    monitoring: '商机监控',
    monitoringValue: '未开启',
    team: '团队成员',
    teamValue: '仅自己',
    plan: '套餐与用量',
    planValue: '试用',
    about: '关于',
    comingSoon: '该功能即将上线',
  },
  login: {
    title: '登录',
  },
  errors: {
    network: '网络连接失败，请稍后重试',
    unauthorized: '登录已过期，请重新登录',
    forbidden: '没有权限执行此操作',
    notFound: '请求的内容不存在',
    rateLimited: '操作太频繁，请稍后再试',
    server: '服务暂时不可用，请稍后重试',
    unknown: '出了点问题，请稍后重试',
  },
} as const

export type Messages = typeof zh
