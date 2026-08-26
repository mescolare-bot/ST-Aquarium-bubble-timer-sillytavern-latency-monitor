export const abnormalOptimizationSuggestionRules = {
    failed_without_output: {
        base: [
            '建议切换模型重试',
            '建议检查当前连接稳定性',
            '建议减少上下文负担后重试',
        ],
        local_full: [
            '建议查看本轮阶段耗时明细',
            '建议检查提示词组装是否明显过重',
        ],
        cloud_full: [
            '建议检查云端请求链路稳定性',
            '建议查看后台记录中的失败阶段',
        ],
    },
    failed_after_partial_output: {
        base: [
            '建议重新生成当前楼层',
            '建议切换为非流式生成重试',
            '建议检查当前连接稳定性',
        ],
        local_full: [
            '建议检查流式输出相关设置',
            '建议查看本轮阶段耗时明细',
        ],
        cloud_full: [
            '建议检查云端流式传输链路',
            '建议查看后台失败阶段记录',
        ],
    },
    failed_generation: {
        base: [
            '建议重新生成当前楼层',
            '建议切换模型重试',
            '建议减少上下文负担后重试',
        ],
        local_full: [
            '建议查看本轮来源注入体量',
            '建议检查提示词组装是否明显过重',
        ],
        cloud_full: [
            '建议查看后台失败阶段记录',
            '建议确认部署环境是否存在波动',
        ],
    },
    request_timeout: {
        base: [
            '建议检查超时设置是否过短',
            '建议减少上下文负担后重试',
            '建议切换模型重试',
        ],
        local_full: [
            '建议查看最慢阶段是否集中在请求模型前后',
            '建议检查提示词组装是否过重',
        ],
        cloud_full: [
            '建议检查云端请求链路稳定性',
            '建议查看后台记录中的失败阶段',
        ],
    },
    stream_interrupted: {
        base: [
            '建议切换为非流式生成重试',
            '建议检查当前连接稳定性',
            '建议重新生成当前楼层',
        ],
        local_full: [
            '建议检查流式输出相关设置',
            '建议查看本轮阶段耗时明细',
        ],
        cloud_full: [
            '建议检查云端流式传输链路',
            '建议查看后台失败阶段记录',
        ],
    },
    suspected_incomplete_generation: {
        base: [
            '建议重新生成当前楼层',
            '建议检查最大输出长度设置',
            '建议减少上下文负担后重试',
        ],
        local_full: [
            '建议查看本轮来源注入体量',
            '建议检查提示词组装是否明显过重',
        ],
        cloud_full: [
            '建议查看后台失败阶段记录',
            '建议确认部署环境是否存在波动',
        ],
    },
};

export const abnormalOptimizationStageSuggestionRules = {
    preprocess: [
        '建议检查本轮输入内容是否异常',
        '建议减少本轮附加内容后重试',
    ],
    retrieval: [
        '建议减少附加来源内容后重试',
        '建议检查记忆与向量检索参与量',
    ],
    prompt_assembly: [
        '建议减少聊天历史参与范围',
        '建议检查本轮提示词体量是否过重',
    ],
    request_model: [
        '建议检查当前连接稳定性',
        '建议检查超时设置是否过短',
    ],
    before_first_output: [
        '建议检查请求等待时间是否过长',
        '建议切换模型重试',
    ],
    full_return: [
        '建议检查最大输出长度设置',
        '建议重新生成当前楼层',
    ],
};

export const abnormalOptimizationStreamingSuggestionRules = {
    streaming: [
        '建议切换为非流式生成重试',
    ],
    non_streaming: [
        '建议切换为流式生成重试',
    ],
};

export const abnormalOptimizationContextSuggestionRules = [
    '建议减少聊天历史参与范围',
    '建议减少世界书注入内容',
    '建议减少记忆注入内容',
    '建议减少向量检索参与量',
];

export const abnormalOptimizationFailedGenerationTypes = [
    'failed_without_output',
    'failed_after_partial_output',
    'failed_generation',
    'stream_interrupted',
    'suspected_incomplete_generation',
];
