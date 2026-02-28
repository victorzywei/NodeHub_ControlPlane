import { test, expect } from '@playwright/test'

const adminKey = process.env.PLAYWRIGHT_ADMIN_KEY || ''

test('smoke: login -> create-node -> release -> subscription', async ({ page }) => {
  test.skip(!adminKey, 'PLAYWRIGHT_ADMIN_KEY is not provided')

  const suffix = Date.now().toString().slice(-6)
  const nodeName = `e2e-node-${suffix}`
  const subName = `e2e-sub-${suffix}`

  await page.goto('/login')
  await page.getByLabel('Admin Key').fill(adminKey)
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page).toHaveURL(/\/overview/)

  // Create node
  await page.getByRole('link', { name: '节点' }).click()
  await expect(page).toHaveURL(/\/nodes/)
  await page.getByRole('button', { name: '新建节点' }).click()

  const nodeDrawer = page.locator('.drawer').last()
  await nodeDrawer.getByLabel('名称').fill(nodeName)
  await nodeDrawer.getByLabel('区域').fill('e2e-region')
  await nodeDrawer.getByLabel('入口 Direct').fill(`node-${suffix}.example.com`)
  await nodeDrawer.getByRole('button', { name: '保存' }).click()

  await expect(page.getByRole('cell', { name: nodeName })).toBeVisible()

  // Release flow (drawer apply)
  await page.getByRole('link', { name: '发布中心' }).click()
  await expect(page).toHaveURL(/\/release/)

  await page.getByRole('button', { name: '新增应用' }).click()
  const releaseDrawer = page.locator('.drawer').last()
  await releaseDrawer.getByLabel(nodeName).check()
  await releaseDrawer.locator('article').nth(1).locator('input[type="checkbox"]:not([disabled])').first().check()
  await releaseDrawer.getByRole('button', { name: '立即应用' }).click()

  await expect(page.getByText('最近10次操作')).toBeVisible()

  // Subscription flow
  await page.getByRole('link', { name: '订阅' }).click()
  await expect(page).toHaveURL(/\/subscriptions/)
  await page.getByRole('button', { name: /创建订阅|新建订阅/ }).click()

  const subDrawer = page.locator('.drawer').last()
  await subDrawer.getByLabel('订阅名称').fill(subName)
  await subDrawer.getByRole('button', { name: '保存' }).click()

  await expect(page.getByRole('cell', { name: subName })).toBeVisible()
})
