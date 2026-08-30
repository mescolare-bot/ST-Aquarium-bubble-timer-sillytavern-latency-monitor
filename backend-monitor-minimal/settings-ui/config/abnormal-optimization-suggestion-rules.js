// 文案约定：
// 1. 不写"建议"开头，区块标题已经是「建议操作方向」，每条再重复一遍纯占宽度。
// 2. 每一条都必须是用户自己能动手做的事。"检查云端链路稳定性""确认部署环境是否波动"
//    这种话用户无从下手，写了等于没写。
// 3. 不写"去看后台记录"，用户正在看的就是这张卡片。
// 4. local_full 给能改服务器配置的人看，cloud_full 给只能在自己这一侧动手的人看。

export const abnormalOptimizationSuggestionRules = {
    client_disconnected: {
        base: [
            '换一个代理节点或网络再试，不少节点会掐掉一直没有数据的连接',
            '如果每次断开都卡在同一个秒数上，那是中间某一环的超时，跟模型无关',
            '别在生成途中切走到别的 App，也别切换 Wi-Fi 和流量',
            '模型那边可能已经在跑并且已经计费，重开一次之前先确认',
        ],
        local_full: [
            '首包本来就慢的话，让服务端在等待期间发心跳，连接就不会被判定为空闲',
        ],
        cloud_full: [
            '问一下服务提供方，连接多久没有数据会被断开',
        ],
    },
    failed_without_output: {
        base: [
            '换一个模型重试，当前模型可能正在故障',
            '减少聊天历史、世界书和记忆的注入量后重试',
            '检查代理和网络是否稳定',
        ],
        local_full: [
            '展开这条记录看各阶段耗时，能看出卡在了哪一步',
        ],
        cloud_full: [
            '连着几条都这样的话多半是服务方在波动，等几分钟再试',
        ],
    },
    failed_after_partial_output: {
        base: [
            '重新生成这一楼',
            '关掉流式输出再试一次，一次性返回不容易被中途打断',
            '检查代理和网络是否稳定',
        ],
        local_full: [
            '展开这条记录看各阶段耗时，能看出是在哪一步断的',
        ],
        cloud_full: [
            '连着几条都断在半路的话，等几分钟再试',
        ],
    },
    failed_generation: {
        base: [
            '重新生成这一楼',
            '换一个模型重试',
            '减少聊天历史、世界书和记忆的注入量后重试',
        ],
        local_full: [
            '展开这条记录看注入来源，能看出是哪一块把提示词撑大了',
        ],
        cloud_full: [
            '连着几条都失败的话多半是服务方在波动，等几分钟再试',
        ],
    },
    request_timeout: {
        base: [
            '把超时时间调大一些再试',
            '减少聊天历史、世界书和记忆的注入量，提示词越大越慢',
            '换一个响应更快的模型',
        ],
        local_full: [
            '展开这条记录看各阶段耗时，能看出时间花在了请求模型前还是后',
        ],
        cloud_full: [
            '高峰时段容易超时，错开再试',
        ],
    },
    stream_interrupted: {
        base: [
            '关掉流式输出再试一次，一次性返回不容易被中途打断',
            '重新生成这一楼',
            '检查代理和网络是否稳定',
        ],
        local_full: [
            '检查反向代理有没有开启响应缓冲，缓冲会打断流式传输',
        ],
        cloud_full: [
            '连着几条都在传输中断的话，等几分钟再试',
        ],
    },
    suspected_incomplete_generation: {
        base: [
            '把最大输出长度调大，内容可能是被长度上限截断的',
            '直接让它续写，接着上次断掉的地方写下去',
            '重新生成这一楼',
        ],
        local_full: [
            '展开这条记录看注入来源，提示词占太多会挤掉可输出的长度',
        ],
        cloud_full: [
            '换一个输出上限更高的模型',
        ],
    },
};

export const abnormalOptimizationStageSuggestionRules = {
    preprocess: [
        '检查这一楼的输入里有没有异常内容',
    ],
    retrieval: [
        '关掉或调小向量检索的参与量再试',
    ],
    prompt_assembly: [
        '缩小聊天历史的参与范围再试',
    ],
    request_model: [
        '检查代理和网络是否稳定',
    ],
    before_first_output: [
        '换一个响应更快的模型，这次是等首字就没等到',
    ],
    full_return: [
        '把最大输出长度调大再试',
    ],
};

export const abnormalOptimizationStreamingSuggestionRules = {
    streaming: [
        '关掉流式输出再试一次',
    ],
    non_streaming: [
        '打开流式输出，能更早看到内容有没有在返回',
    ],
};

// 只有"传输被打断"这一类才该建议关流式。
// 对被长度截断的情况它无关，对连接中断它甚至有害：关掉流式之后首包前的静默更长，
// 反而更容易撞上中间环节的空闲超时。
export const abnormalOptimizationStreamingRelevantTypes = [
    'stream_interrupted',
    'failed_after_partial_output',
];

export const abnormalOptimizationContextSuggestionRules = [
    '缩小聊天历史的参与范围',
    '减少世界书的注入条目',
    '减少记忆注入的内容',
    '调小向量检索的参与量',
];

export const abnormalOptimizationFailedGenerationTypes = [
    'client_disconnected',
    'failed_without_output',
    'failed_after_partial_output',
    'failed_generation',
    'request_timeout',
    'stream_interrupted',
    'suspected_incomplete_generation',
];

// 用户自己按的停止不是故障，记录保留下来方便回溯，但没有任何"该怎么办"可给。
export const abnormalOptimizationSuppressedTypes = [
    'client_stopped',
];
