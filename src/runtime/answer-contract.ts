import type { AnswerContract, AnswerRequirement } from '../domain.js';

export type { AnswerQuestionType, AnswerRequirement, AnswerContract } from '../domain.js';

export function buildAnswerContract(input: {
  originalQuestion: string;
  resolvedQuestion: string;
}): AnswerContract {
  const originalQuestion = bound(input.originalQuestion.trim(), 1600);
  const resolvedQuestion = bound(input.resolvedQuestion.trim(), 2000);
  const normalized = normalize(`${resolvedQuestion}\n${originalQuestion}`);
  const hasCausalQuestionIntent = /(为什么|原因|为何|怎么会|为何会)/.test(normalized);
  const hasFailureStatusSignal = /(失败|异常|报错|打不开|无法|不生效|缺少|没有数据|没有执行|未执行)/.test(normalized);
  const hasOperationIntent =
    /(怎么|如何|怎样).{0,24}(处理|补上|补齐|补数据|补统计|补跑|重跑|手动执行|执行|运行|触发|跑|命令行|命令|制定|创建|生成|新建|添加|配置|设置)/.test(normalized) ||
    /(处理|补上|补齐|补数据|补统计|补跑|重跑|手动执行|命令行处理|有没有命令行|有没有命令)/.test(normalized);
  const hasConfigurationLocationIntent = /(在哪|哪里|入口|路径|位置|从哪).{0,20}(配置|设置)|(配置|设置).{0,20}(在哪|哪里|入口|路径|位置)/.test(normalized);
  const hasBugOrBehaviorClassificationIntent =
    /(是不是|是否|属于|算不算|算是|归类|归为|判断|判定).{0,16}((系统)?bug|设计使然|产品设计|配置问题|使用问题|操作问题)/.test(normalized) ||
    /(这|这个|该|当前)?是.{0,16}((系统)?bug|设计使然|产品设计|配置问题|使用问题|操作问题)/.test(normalized) ||
    /((系统)?bug|设计使然|产品设计|配置问题|使用问题|操作问题).{0,12}还是.{0,12}((系统)?bug|设计使然|产品设计|配置问题|使用问题|操作问题)/.test(normalized) ||
    /((系统)?bug|设计使然|产品设计|配置问题|使用问题|操作问题).{0,4}(吗|呢)$/.test(normalized);

  if (hasBugOrBehaviorClassificationIntent) {
    return contract({
      originalQuestion,
      resolvedQuestion,
      questionType: 'bug_or_behavior',
      userNeed: '判断现象属于缺陷、设计、配置还是使用问题',
      mustAnswer: [
        req('classification', '问题归类', '明确属于系统 bug、设计使然、配置问题、使用问题或目前不能确认'),
        req('basis', '判断依据', '支撑归类的产品规则、证据或限制条件'),
        req('next_action', '下一步动作', '对应处理建议、验证方式或升级条件'),
      ],
      usefulContext: [
        req('observed_behavior', '实际表现', '用户看到的现象'),
        req('expected_behavior', '预期表现', '用户或产品预期的行为'),
      ],
      missingTolerance: 'partial_allowed_with_escalation',
      finalAnswerExpectation: '先归类为 bug、设计、配置/使用问题或不能确认，再说明依据和处理建议。',
    });
  }

  if (hasCausalQuestionIntent) {
    return contract({
      originalQuestion,
      resolvedQuestion,
      questionType: 'troubleshooting_cause',
      userNeed: '确认原因、影响和下一步处理',
      mustAnswer: [
        req('observed_symptom', '现象', '用户看到的现象或失败点'),
        req('cause_or_likely_cause', '原因或高置信推断', '有证据支持的原因或排查结论'),
        req('next_action', '下一步动作', '处理方式、验证方式或需要补充的信息'),
      ],
      usefulContext: [req('related_rule', '相关规则', '能帮助理解问题的产品规则')],
      missingTolerance: 'partial_allowed_with_escalation',
      finalAnswerExpectation: '区分已确认原因、推断和未知，并给出下一步处理。',
    });
  }

  if (hasOperationIntent) {
    return contract({
      originalQuestion,
      resolvedQuestion,
      questionType: 'operation_procedure',
      userNeed: '获得可执行的处理方式',
      mustAnswer: [
        req('operation_method', '处理方式', '明确采用命令、入口、任务或脚本中的哪一种方式处理'),
        req('command_or_entry', '命令或入口', '现成命令名称、入口路径、任务名称或脚本名称'),
        req('scope_or_parameters', '范围或参数', '如何指定对象、月份、时间范围或其他必要参数'),
        req('verification_or_caveat', '验证或注意事项', '执行后的验证方式、风险、前置条件或适用条件'),
      ],
      usefulContext: [
        req('generation_source', '生成来源', '相关数据由哪个任务、服务或流程产生'),
        req('known_cause', '已知原因', '用户已确认或知识库确认的背景原因'),
      ],
      missingTolerance: 'partial_allowed_with_escalation',
      finalAnswerExpectation: '给出可执行步骤；如无法确认现成命令，说明已确认部分和继续排查焦点。',
    });
  }

  if (hasConfigurationLocationIntent) {
    return contract({
      originalQuestion,
      resolvedQuestion,
      questionType: 'configuration_location',
      userNeed: '找到功能配置入口和可配置范围',
      mustAnswer: [
        req('entry_path', '入口路径', '菜单、后台路径、路由或页面位置'),
        req('permission_or_role', '权限或角色', '哪些角色或权限可以进入该配置'),
        req('configurable_items', '可配置项', '该入口下能配置哪些内容'),
      ],
      usefulContext: [req('feature_context', '功能背景', '功能定义或适用模块')],
      missingTolerance: 'full_required',
      finalAnswerExpectation: '直接说明入口路径、权限/路由信息和主要可配置项。',
    });
  }

  if (hasFailureStatusSignal) {
    return contract({
      originalQuestion,
      resolvedQuestion,
      questionType: 'troubleshooting_cause',
      userNeed: '确认原因、影响和下一步处理',
      mustAnswer: [
        req('observed_symptom', '现象', '用户看到的现象或失败点'),
        req('cause_or_likely_cause', '原因或高置信推断', '有证据支持的原因或排查结论'),
        req('next_action', '下一步动作', '处理方式、验证方式或需要补充的信息'),
      ],
      usefulContext: [req('related_rule', '相关规则', '能帮助理解问题的产品规则')],
      missingTolerance: 'partial_allowed_with_escalation',
      finalAnswerExpectation: '区分已确认原因、推断和未知，并给出下一步处理。',
    });
  }

  if (/(规则|政策|限制|条件|标准|机制|参数).{0,20}(是什么|什么是|有哪些|说明|解释|怎么理解)|(是什么|什么是).{0,20}(规则|政策|限制|条件|标准|机制|参数)/.test(normalized)) {
    return contract({
      originalQuestion,
      resolvedQuestion,
      questionType: 'rule_explanation',
      userNeed: '理解规则含义、适用条件和边界',
      mustAnswer: [
        req('rule_summary', '规则说明', '规则本身的含义和核心判断标准'),
        req('applicability', '适用条件', '规则适用于哪些对象、场景或状态'),
        req('edge_cases', '边界或例外', '限制、例外、注意事项或无法确认的部分'),
      ],
      usefulContext: [req('examples', '示例', '能帮助理解规则的典型例子')],
      missingTolerance: 'full_required',
      finalAnswerExpectation: '直接解释规则是什么、适用条件和重要边界。',
    });
  }

  if (/(是什么|什么是|有什么功能|有哪些功能|功能有哪些|支持哪些|能做什么|能力)/.test(normalized)) {
    return contract({
      originalQuestion,
      resolvedQuestion,
      questionType: /功能|支持|能力|能做/.test(normalized) ? 'feature_overview' : 'definition',
      userNeed: '理解功能定义和能力范围',
      mustAnswer: [
        req('definition', '定义', '这个功能或概念是什么'),
        req('capabilities', '功能能力', '主要功能点、能力范围或典型使用场景'),
      ],
      usefulContext: [req('entry_or_scope', '入口或适用范围', '入口、角色、模块范围等补充信息')],
      missingTolerance: 'full_required',
      finalAnswerExpectation: '先解释是什么，再概括主要功能能力。',
    });
  }

  return contract({
    originalQuestion,
    resolvedQuestion,
    questionType: 'unknown',
    userNeed: '回答用户当前问题',
    mustAnswer: [req('direct_answer', '直接回答', '与原问题直接相关的答案')],
    usefulContext: [],
    missingTolerance: 'partial_allowed_with_escalation',
    finalAnswerExpectation: '围绕原问题直接回答；不足时说明缺口。',
  });
}

function contract(input: AnswerContract): AnswerContract {
  return input;
}

function req(id: string, label: string, description: string): AnswerRequirement {
  return { id, label, description };
}

function normalize(value: string): string {
  return value.replace(/[ \t\r\f\v]+/g, '').toLowerCase();
}

function bound(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}
