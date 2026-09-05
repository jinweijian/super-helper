import {expect,test} from '@playwright/test';

test('排查模式在真实页面按消息提交并在接收后复位',async({page})=>{
  // 生产服务器 fixture 的 Claude 已禁用，模型名和轮数仅用于离线 UI 合同。
  const profiles={enabled:true,fast:{model:'fixture-fast',effort:'low',maxTurns:5},deep:{model:'fixture-deep',effort:'high',timeoutMs:1200000}};
  expect((await page.request.post('/api/settings/claude',{data:{investigationProfiles:profiles}})).ok()).toBe(true);
  try {
    await page.goto('/');
    await expect(page.getByLabel('排查模式',{exact:true})).toBeEnabled();
    await page.getByLabel('排查模式',{exact:true}).selectOption('fast');
    await page.getByLabel('输入问题',{exact:true}).fill('检查当前项目 src/index.ts 的入口');
    const submitted=page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/api/chat');
    const accepted=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/chat');
    await page.getByRole('button',{name:/^发送/}).click();
    expect((await submitted).postDataJSON().investigationPreference).toBe('fast');
    const turn=await(await accepted).json();
    await expect(page.getByLabel('排查模式',{exact:true})).toHaveValue('auto');
    await expect(page.getByLabel('输入问题',{exact:true})).toHaveValue('');
    const session=await(await page.request.get('/api/session?caseId='+turn.caseId+'&includeKnowledgeHealth=false')).json();
    expect(session.session.messages.find((message:{id:string})=>message.id===turn.userMessageId).investigationPreference).toBe('fast');
  } finally {
    await page.request.post('/api/settings/claude',{data:{investigationProfiles:{...profiles,enabled:false}}});
  }
});
