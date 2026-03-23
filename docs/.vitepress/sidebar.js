import { interviewSidebar } from './sidebar/interview'
import { javaSidebar } from './sidebar/java'
import { csSidebar } from './sidebar/cs'
import { databaseSidebar } from './sidebar/database'
import { frameworkSidebar } from './sidebar/framework'
import { distributedSidebar } from './sidebar/distributed'
import { highPerformanceSidebar } from './sidebar/high-performance'
import { middlewareSidebar } from './sidebar/middleware'
import { devopsSidebar } from './sidebar/devops'

export const sidebar = {
  '/interview/': interviewSidebar,
  '/java/': javaSidebar,
  '/cs/': csSidebar,
  '/database/': databaseSidebar,
  '/framework/': frameworkSidebar,
  '/distributed/': distributedSidebar,
  '/high-performance/': highPerformanceSidebar,
  '/middleware/': middlewareSidebar,
  '/devops/': devopsSidebar,
}
