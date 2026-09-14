import {mount} from '@vue/test-utils';
import {expect,it,vi} from 'vitest';
import ChatPanel from './ChatPanel.vue';
import {useChat} from './use-chat';

it('模式随消息发送，服务器接收后复位，发送失败保留选择',async()=>{
  const wrapper=mount(ChatPanel,{props:{sending:false,acceptedCount:0,autoInvestigationEnabled:true}});
  await wrapper.get('[aria-label="排查模式"]').setValue('fast');
  await wrapper.get('textarea').setValue('检查入口');
  await wrapper.get('form').trigger('submit');
  expect(wrapper.emitted('send')?.[0]).toEqual(['检查入口','operations','fast']);
  expect((wrapper.get('[aria-label="排查模式"]').element as HTMLSelectElement).value).toBe('fast');
  await wrapper.setProps({acceptedCount:1});
  expect((wrapper.get('[aria-label="排查模式"]').element as HTMLSelectElement).value).toBe('auto');
});

it('未启用自动模式时仍可手动选择快速或深度',async()=>{
  const wrapper=mount(ChatPanel,{props:{sending:false,acceptedCount:0,autoInvestigationEnabled:false}});
  const mode=wrapper.get('[aria-label="排查模式"]');
  expect(mode.attributes('disabled')).toBeUndefined();
  expect(mode.findAll('option').map(option=>option.text())).toEqual(['快速','深度']);
  await mode.setValue('deep');
  await wrapper.get('textarea').setValue('深度检查入口');
  await wrapper.get('form').trigger('submit');
  expect(wrapper.emitted('send')?.[0]).toEqual(['深度检查入口','operations','deep']);
  expect(wrapper.text()).not.toContain('排查模式尚未启用');
});

it('用户视角属于会话标题栏，运行时停止操作替换发送按钮',async()=>{
  const wrapper=mount(ChatPanel,{props:{
    sending:false,
    acceptedCount:0,
    progress:{state:'running',startedAt:Date.now(),lastActivityAt:Date.now()},
  }});
  expect(wrapper.get('.case-header-actions [aria-label="用户视角"]').element).toBeInstanceOf(HTMLSelectElement);
  expect(wrapper.find('.composer-actions [aria-label="用户视角"]').exists()).toBe(false);
  expect(wrapper.get('.composer-actions .stop-action').text()).toBe('停止排查');
  expect(wrapper.find('.composer-actions .primary').exists()).toBe(false);
  expect(wrapper.find('.progress-line .stop-action').exists()).toBe(false);
  await wrapper.get('.stop-action').trigger('click');
  expect(wrapper.emitted('stop')).toHaveLength(1);
});

it('用户消息不显示角色标签，避免把回答区做成日志列表', async () => {
  const wrapper = mount(ChatPanel, { props: { sending: false, acceptedCount: 0, session: {
    id: 'case_a', title: '问题', status: 'partial', workspaceId: 'current', userPersona: 'operations',
    messages: [{ id: 'u1', role: 'user', body: '检查入口', createdAt: new Date().toISOString() }], runs: [], logs: [],
  } as any } });
  expect(wrapper.find('.message.user strong').exists()).toBe(false);
});

it('停止向服务端发送当前回合 ID，导航 cancel 仅停止本地轮询',async()=>{
  const fetcher=vi.fn(async(input: RequestInfo | URL)=>{
    const url=String(input);
    if(url==='/api/chat')return Response.json({caseId:'case_a',userMessageId:'m1'},{status:202});
    if(url==='/api/chat/cancel')return Response.json({accepted:true},{status:202});
    if(url.startsWith('/api/chat/progress'))return Response.json({progress:{requestedMode:'fast',resolvedProfile:'fast',stage:'reading',searchCount:2,filesRead:1,lastActivityAt:new Date().toISOString()}});
    return Response.json({session:{id:'case_a',status:'diagnosing',messages:[{id:'m1',role:'user',body:'检查'}],runs:[]}});
  });
  const chat=useChat({fetcher,pollDelayMs:1000,trackInvestigation:true});
  const pending=chat.send({message:'检查',workspaceId:'current',persona:'operations',investigationPreference:'fast'}).catch(()=>undefined);
  await vi.waitFor(()=>expect(chat.acceptedCount.value).toBe(1));
  await chat.stop();
  expect(fetcher.mock.calls.some(([url])=>url==='/api/chat/cancel')).toBe(true);
  const before=fetcher.mock.calls.filter(([url])=>url==='/api/chat/cancel').length;
  chat.cancel();
  await pending;
  expect(fetcher.mock.calls.filter(([url])=>url==='/api/chat/cancel').length).toBe(before);
});
