import {mount} from '@vue/test-utils';
import {expect,it,vi} from 'vitest';
import ChatPanel from './ChatPanel.vue';
import {useChat} from './use-chat';

it('模式随消息发送，服务器接收后复位，发送失败保留选择',async()=>{
  const wrapper=mount(ChatPanel,{props:{sending:false,acceptedCount:0,investigationEnabled:true}});
  await wrapper.get('[aria-label="排查模式"]').setValue('fast');
  await wrapper.get('textarea').setValue('检查入口');
  await wrapper.get('form').trigger('submit');
  expect(wrapper.emitted('send')?.[0]).toEqual(['检查入口','operations','fast']);
  expect((wrapper.get('[aria-label="排查模式"]').element as HTMLSelectElement).value).toBe('fast');
  await wrapper.setProps({acceptedCount:1});
  expect((wrapper.get('[aria-label="排查模式"]').element as HTMLSelectElement).value).toBe('auto');
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
