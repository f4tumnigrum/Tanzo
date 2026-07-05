export const zhCN = {
  translation: {
    nav: {
      groups: {
        workspace: '工作区',
        system: '系统'
      },
      items: {
        chat: '对话',
        skills: '技能',
        plugins: '插件',
        providers: '模型服务',
        mcp: 'MCP 服务器',
        usage: '用量',
        settings: '设置'
      }
    },
    update: {
      available: '新版本 {{version}} 可用 — 点击下载',
      downloading: '正在下载更新… {{percent}}%',
      ready: '更新已就绪 — 点击重启并安装',
      progress: {
        size: '{{transferred}} / {{total}}'
      }
    },
    browser: {
      toggle: '切换浏览器',
      back: '后退',
      forward: '前进',
      reload: '刷新',
      maximize: '最大化',
      restore: '恢复分屏',
      close: '关闭浏览器',
      address: '地址',
      addressPlaceholder: '搜索或输入网址',
      clear: '清除',
      error: {
        title: '无法加载此页面',
        code: '错误 {{code}}',
        retry: '重试'
      },
      tabs: {
        new: '新建标签页',
        close: '关闭标签页'
      },
      picker: {
        pick: '拾取元素',
        picking: '点击页面元素…(Esc 取消)',
        copyAll: '复制全部',
        copied: '已复制',
        closePanel: '关闭面板',
        groups: {
          color: '颜色',
          typography: '排版',
          layout: '布局',
          spacing: '间距',
          border: '边框',
          effects: '效果'
        },
        fields: {
          textColor: '文字',
          background: '背景',
          gradient: '渐变',
          borderColor: '边框',
          fontFamily: '字体',
          fontSize: '字号',
          fontWeight: '字重',
          lineHeight: '行高',
          letterSpacing: '字距',
          textAlign: '对齐',
          textTransform: '大小写',
          display: '显示',
          flexDirection: '方向',
          justifyContent: '主轴',
          alignItems: '交叉轴',
          padding: '内边距',
          margin: '外边距',
          gap: '间隔',
          borderWidth: '粗细',
          borderStyle: '样式',
          borderRadius: '圆角',
          opacity: '不透明度',
          boxShadow: '阴影',
          filter: '滤镜',
          backdropFilter: '背景滤镜',
          transform: '变换'
        }
      }
    },
    usage: {
      page: {
        title: '用量'
      },
      stats: {
        conversations: '会话',
        runs: '运行'
      },
      range: {
        '24h': '24 小时',
        '7d': '7 天',
        '30d': '30 天',
        all: '全部'
      },
      kpis: {
        totalTokens: '总 token',
        tokensLead: '全部运行累计',
        tokensHint: '{{runs}} 次运行',
        inputTokens: '输入 token',
        inputLead: '提示与上下文',
        outputTokens: '输出 token',
        outputLead: '模型生成',
        outputHint: '模型补全输出',
        cacheHitRatio: '缓存命中率',
        cacheLeadGood: '缓存效果良好',
        cacheLeadLow: '缓存复用偏低',
        cacheHint: '读 {{read}} · 写 {{write}}'
      },
      models: {
        title: '按模型',
        model: '模型',
        runs: '运行',
        input: '输入',
        output: '输出',
        total: '合计'
      },
      charts: {
        trend: 'token 用量趋势',
        trendHint: '各时间桶的输入与输出 token',
        input: '输入',
        output: '输出'
      },
      runs: {
        title: '会话明细',
        summary: '{{runs}} 次运行 · {{total}} token',
        prev: '上一页',
        next: '下一页',
        first: '第一页',
        last: '最后一页',
        untitled: '未命名'
      },
      table: {
        caption: '按会话查看 token 用量，点击可查看逐步骤明细。',
        columns: '列',
        conversation: '会话',
        runs: '运行',
        lastRun: '最近运行',
        noResults: '当前视图没有匹配的会话。',
        showing: '显示 {{count}} / {{total}} 个会话',
        page: '第 {{page}} / {{pageCount}} 页'
      },
      runDetail: {
        empty: '该运行暂无明细。',
        steps: '步骤',
        input: '输入',
        output: '输出',
        cacheRead: '缓存读取',
        total: '合计'
      },
      empty: {
        title: '暂无用量数据',
        description: '发起一次对话即可开始统计 token 用量。'
      },
      error: {
        title: '无法加载用量数据',
        description: '读取用量数据时出错。'
      }
    },
    chat: {
      page: {
        title: '对话'
      },
      sidebar: {
        newConversation: '新建对话',
        openWorkspace: '打开工作区',
        collapseSidebar: '收起侧边栏',
        expandSidebar: '展开侧边栏',
        empty: '暂无对话',
        emptyState: {
          title: '还没有工作区',
          description: '打开一个项目文件夹，开始与你的代码库对话。',
          action: '打开工作区'
        },
        delete: '删除会话',
        rename: '重命名',
        pin: '置顶会话',
        unpin: '取消置顶',
        newWorkspaceConversation: '在该工作区新建对话',
        removeWorkspaceAction: '删除工作区',
        removeWorkspace: {
          title: '删除工作区 {{group}} ？',
          description:
            '工作区会从列表中移除，其中的 {{count}} 个对话也会被永久删除。磁盘上的文件不会被删除。'
        },
        deleteFamily: {
          title: '删除此对话及其分支？',
          description: '该对话以及它的 {{count}} 个分支都会被永久删除，此操作无法撤销。'
        },
        justNow: '刚刚',
        minutesAgo: '{{count}} 分钟前',
        hoursAgo: '{{count}} 小时前',
        yesterday: '昨天',
        daysAgo: '{{count}} 天前'
      },
      workspace: {
        pickerTitle: '选择工作区文件夹'
      },
      composer: {
        modelSelector: {
          pick: '选择模型',
          loading: '加载模型中…',
          empty: '未配置模型',
          emptyHint: '请在设置中连接服务商后再选择模型。',
          searchPlaceholder: '搜索模型…',
          selectProvider: '请在左侧选择服务商',
          noMatches: '没有匹配的模型',
          tabAgent: '主模型',
          tabSubagent: '子代理'
        },
        defaultPlaceholder: '发送消息 · Enter 发送 · Shift+Enter 换行',
        steeringPlaceholder: '排队等本轮结束后发送 · Enter 排队 · ⌘/Ctrl+Enter 立即引导',
        steer: '立即引导',
        steerShortcut: '立即引导 · ⌘/Ctrl+Enter',
        queue: '排队',
        queueShortcut: '排队 · Enter',
        queuedTitle: '排队消息',
        queuedSteer: '立即引导',
        removeQueued: '移除',
        todoPanel: {
          label: '任务',
          empty: '暂无任务'
        },
        attachmentsStreamingDisabled: '运行中暂不支持添加附件。',
        attachments: {
          attach: '添加图片',
          remove: '移除图片',
          tooLarge: '图片过大（上限 10MB）。',
          onlyImages: '只能添加图片文件。',
          imageTitle: '图片'
        },
        stop: '停止',
        stopping: '正在停止…',
        send: '发送',
        sendShortcut: '发送 · Enter',
        permissionModeLabel: '权限模式',
        permissionMode: {
          default: {
            label: '询问',
            tooltip: '每次工具调用前询问。'
          },
          plan: {
            label: '计划',
            tooltip: '计划模式：禁止写入操作。'
          },
          yolo: {
            label: '自动',
            tooltip: '自动批准所有工具调用。'
          },
          dangerous: {
            label: '危险',
            tooltip: '危险模式：自动批准工具调用，并允许访问工作区以外的路径。'
          }
        },
        reasoningEffort: {
          default: '自动',
          none: '关闭',
          minimal: '极简',
          low: '低',
          medium: '中',
          high: '高',
          xhigh: '极高',
          max: '最高'
        },
        context: {
          saved: '已节省 {{tokens}}',
          compacted: '已压缩',
          usageLabel: '压缩触发用量：{{percent}}%',
          usageUnknown: '压缩触发用量未知',
          used: '已用 {{percent}}%',
          left: '距压缩 {{tokens}}',
          waitingForLiveUsage: '等待实时用量',
          compactedToast: '上下文已压缩。',
          noCompactNeeded: '暂时无需压缩。',
          compactAborted: '已取消压缩。',
          compactStale: '压缩期间对话已变更，未归档任何内容。'
        },
        slashCommands: {
          empty: '未找到命令。',
          groups: {
            builtin: '操作',
            agent: '智能体',
            command: '命令',
            skill: '技能'
          },
          descriptions: {
            compact: '压缩当前会话上下文',
            goal: '设定、更换或清除自主目标',
            agent: '切换当前会话智能体'
          }
        },
        mentions: {
          groups: {
            plugin: '插件',
            file: '文件'
          }
        }
      },
      approval: {
        permissionTitle: '需要授权',
        pending: '待批准',
        approve: '批准',
        deny: '拒绝',
        bulk: {
          count: '{{count}} 项待批准',
          approveAll: '全部批准',
          denyAll: '全部拒绝'
        },
        reasonPlaceholder: '可选原因 — 模型能看到',
        scope: {
          once: '本次',
          session: '本会话',
          forever: '永久'
        },
        target: {
          path: '路径',
          command: '命令',
          url: '链接',
          value: '目标'
        }
      },
      subagentApproval: {
        title: '子代理（{{agent}}）请求批准 {{tool}}',
        objective: '目标',
        run: '运行 ID',
        phase: '阶段',
        capabilities: '允许的工具',
        allTools: '全部工具',
        suggestion: {
          retry: '换个方式',
          amend: '修改命令',
          skip: '跳过此步',
          abort: '终止'
        }
      },
      planReview: {
        title: '计划待审查',
        pending: '等待批准',
        download: '下载为 Markdown',
        approveExecute: '批准并执行',
        autoRun: '自动运行',
        reject: '拒绝',
        approved: '已批准',
        rejected: '已拒绝'
      },
      question: {
        label: '提问',
        waiting: '等待输入',
        meta: {
          count_one: '{{count}} 个问题',
          count_other: '{{count}} 个问题',
          answered: '已回答 {{done}}/{{total}}',
          discussing: '讨论中'
        },
        type: {
          single: '单选',
          multi: '多选',
          rank: '排序'
        },
        selected_one: '已选 {{count}} 项',
        selected_other: '已选 {{count}} 项',
        ranked_one: '已排序 {{count}} 项',
        ranked_other: '已排序 {{count}} 项',
        ready: '可以提交了',
        currentReady: '可以继续',
        canBrowse: '可以先浏览',
        needsAll: '回答全部问题后提交',
        needsAnswer: '选择一个答案后继续',
        page: '第 {{current}} / {{total}} 题',
        previous: '上一题',
        next: '下一题',
        loadingOptions: '正在加载选项…',
        decoding: '正在准备问题…',
        customPlaceholder: '或输入你自己的答案',
        discuss: '先讨论一下',
        send_one: '提交回答',
        send_other: '提交回答',
        noAnswer: '未回答',
        error: '提问失败。',
        moveUp: '上移',
        moveDown: '下移',
        declined: {
          title: '用户选择先讨论一下。',
          default: '未选择任何选项 — 继续对话即可。'
        }
      },
      message: {
        userMessage: {
          showMore: '展开',
          showLess: '收起'
        },
        edit: {
          action: '编辑消息',
          send: '发送',
          cancel: '取消'
        },
        xmlTag: {
          reasoning: '推理',
          planning: '规划',
          observation: '观察',
          reflection: '反思',
          response: '回复'
        },
        tokenUsage: {
          in: '输入',
          out: '输出',
          reason: '推理',
          cacheRead: '缓存读取',
          cacheWrite: '缓存写入'
        },
        parts: {
          plan: {
            title: '计划',
            status: {
              pending: '待处理',
              active: '进行中',
              done: '已完成'
            }
          },
          todo: {
            status: {
              pending: '待处理',
              in_progress: '进行中',
              completed: '已完成'
            }
          }
        },
        compaction: {
          compacting: '正在压缩上下文…',
          compacted: '上下文已压缩',
          failed: '压缩失败',
          autoTag: '自动',
          summary: '压缩摘要',
          reduced: '减少原始上下文 {{tokens}}',
          tokens: '原始记录 {{before}} → 模型视图 {{after}} tokens',
          omitted: '省略 {{count}} 条较早消息。',
          toolPruning: '已应用工具结果剪枝。'
        },
        subagentResult: {
          status: {}
        },
        streamingIndicator: {
          fallback: '处理中...',
          messages: {
            pullingSignal: '正在提炼重点...',
            cuttingFluff: '先把多余的话收掉...',
            plainLanguage: '正在把复杂问题说清楚...',
            straighteningLogic: '我再替你顺顺逻辑...',
            tighteningWording: '正在收紧表述...',
            deeperPass: '再往深处捞一层...',
            actionableAnswer: '正在整理成可执行的答案...',
            skippingDetours: '先跳过绕路的部分...',
            polishingUsefulBits: '正在打磨真正有用的部分...',
            honestAnswer: '尽量把话说明白...',
            nextMove: '正在对齐下一步...',
            untanglingMess: '先把乱的地方理顺...',
            sharpeningConclusion: '正在把结论磨尖一点...',
            reducingAiAftertaste: '尽量少一点 AI 味...',
            fillingGaps: '正在补齐缺口...',
            makingItLand: '正在让表达更落地...',
            almostToThePoint: '快好了，重点快出来了...',
            finalPolish: '最后再润一遍...',
            finalDraft: '收尾中，马上发你...',
            notGhosting: '还在处理，马上就好。'
          }
        },
        copy: {
          action: '复制消息',
          code: '复制代码',
          copied: '已复制'
        },
        fork: {
          badge: '分支',
          action: '从这里分叉',
          pending: '正在创建分支会话...',
          placeholder: '分支功能即将上线'
        },
        scrollToBottom: '滚动到底部'
      },
      tool: {
        common: {
          running: '运行中…',
          toggleLineWrap: '切换自动换行',
          error: '工具返回了错误。',
          decodingInput: '正在解析输入'
        },
        status: {
          streaming: '生成中',
          pending: '待处理',
          awaitingApproval: '等待批准',
          approved: '已批准',
          done: '完成',
          error: '错误',
          denied: '已拒绝'
        },
        goal: {
          label: '目标',
          status: {
            complete: '完成',
            blocked: '受阻',
            recorded: '受阻记录 {{attempts}}/{{required}}'
          },
          errors: {
            updateFailed: '目标更新失败。'
          }
        },
        shell: {
          noOutput: '无输出。',
          noSessions: '无会话。',
          stopped: '已停止',
          exit: {
            running: '运行中',
            stopped: '已停止',
            failed: '失败',
            timeout: '超时',
            aborted: '已中止'
          },
          errors: {
            commandFailed: '命令执行失败。'
          }
        },
        grep: {
          noMatches: '无匹配。',
          truncated: '结果已截断。请缩小搜索范围或使用 offset 翻页。',
          matchesCount_one: '{{count}} 处匹配',
          matchesCount_other: '{{count}} 处匹配',
          filesCount_one: '{{count}} 个文件',
          filesCount_other: '{{count}} 个文件',
          caseInsensitive: '忽略大小写',
          multiline: '多行',
          errors: {
            searchFailed: '搜索失败。'
          }
        },
        glob: {
          noMatches: '无匹配文件。',
          truncated: '结果列表已截断。请细化匹配模式或使用 offset 翻页。',
          hitsCount_one: '{{count}} 个结果',
          hitsCount_other: '{{count}} 个结果',
          includingIgnored: '包含被忽略的文件',
          errors: {
            globFailed: 'Glob 失败。'
          }
        },
        fileRead: {
          lines_one: '{{count}} 行',
          lines_other: '{{count}} 行',
          linesPlus: '{{count}}+ 行',
          cells_one: '{{count}} 个单元格',
          cells_other: '{{count}} 个单元格',
          truncated: '已截断',
          moreAvailable: '还有更多',
          errors: {
            readFailed: '读取失败。'
          }
        },
        fileWrite: {
          errors: {
            writeFailed: '写入失败。'
          }
        },
        fileEdit: {
          replacements_one: '{{count}} 处替换',
          replacements_other: '{{count}} 处替换',
          edits_one: '{{count}} 处编辑',
          edits_other: '{{count}} 处编辑',
          replaceAll: '全部替换',
          errors: {
            editFailed: '编辑失败。'
          }
        },
        dynamic: {
          label: '工具',
          input: '输入',
          output: '输出',
          errors: {
            toolFailed: '工具执行失败。'
          }
        },
        todo: {
          label: '任务',
          items_one: '{{count}} 项',
          items_other: '{{count}} 项',
          dropped: '已移除',
          unfinishedRemoved: '未完成项已移除',
          errors: {
            updateFailed: '更新任务失败。'
          }
        },
        skill: {
          label: '技能',
          loaded: '已加载',
          loading: '正在加载 {{skill}}…',
          loadingInstructions: '正在加载说明…',
          ready: '说明已加入本轮运行。',
          instructions: '说明',
          source: '来源',
          args: '参数',
          allTools: '全部工具',
          tools_one: '{{count}} 个工具',
          tools_other: '{{count}} 个工具',
          noTools: '无工具',
          allToolsAllowed: '允许全部工具',
          errors: {
            activationFailed: '启用技能失败。'
          }
        },
        browser: {
          label: '浏览器',
          url: '网址',
          actions: {
            browserOpen: '打开浏览器'
          },
          errors: {
            failed: '浏览器操作失败。'
          }
        },
        subagent: {
          label: '子代理',
          run: '子代理',
          action: {
            spawn: '已委派',
            await: '结果来自',
            tasks: '已查看',
            steer: '已调整方向',
            cancel: '已停止',
            report: '已汇报'
          },
          status: {
            pending: '待处理',
            running: '运行中',
            blocked: '已阻塞',
            done: '已完成',
            failed: '失败',
            cancelled: '已取消'
          },
          acked: '完成。',
          ack: {
            instructed: '已发送补充指令。',
            redefined: '已替换目标。',
            cancelled: '已停止子代理。',
            phaseReported: '已更新阶段。',
            resultSubmitted: '已提交结果。'
          },
          noTasks: '暂无子代理。',
          allTasks: '全部子代理',
          filteredRuns: '子代理 · {{status}}',
          subagentCount: '{{count}} 个子代理',
          result: '结果',
          resultFailed: '失败',
          dependsOn: '依赖 {{tasks}}。',
          blockedDependency: '等待 {{tasks}}。',
          blockedBy: '受阻于',
          waitingFor: '等待',
          blockedApproval: '等待批准。',
          awaitPending: '仍在运行：{{tasks}}。',
          inferred: '推断',
          resultInferred: '结果由最后一条助手消息推断——子代理未调用 report()。',
          errors: {
            taskFailed: '子代理失败。'
          }
        }
      },
      taskPanel: {
        title: '子代理',
        taskCount: '共 {{count}} 个',
        running: '进行中',
        done: '已完成',
        blockedDependency: '等待 {{tasks}}',
        blockedApproval: '等待批准',
        interrupted: '已中断——应用曾重启。点击重试恢复。'
      },
      goal: {
        pause: '暂停目标',
        resume: '恢复目标',
        clear: '清除目标',
        edit: '编辑目标',
        save: '保存目标',
        cancelEdit: '取消编辑',
        editPlaceholder: '目标内容',
        status: {
          active: '进行中',
          paused: '已暂停',
          blocked: '受阻',
          budget_limited: '预算用尽',
          usage_limited: '额度受限',
          complete: '已完成'
        },
        command: {
          current: '目标：{{objective}}（{{status}}）',
          none: '当前没有目标。',
          cleared: '目标已清除。',
          paused: '目标已暂停。',
          resumed: '目标已恢复。',
          objectiveUpdated: '目标内容已更新。',
          set: '目标已设置。'
        }
      },
      errors: {
        deleteConversation: '删除对话失败。',
        forkConversation: '创建分支会话失败。',
        goalCommand: '更新目标失败。',
        startRun: '启动对话运行失败。',
        setModel: '切换模型失败。',
        setAgent: '切换智能体失败。',
        renameConversation: '重命名对话失败。',
        pinConversation: '置顶对话失败。',
        agentCommandMissing: '用法：/agent <名称|ID>。',
        agentCommandUnknown: '未找到“{{agent}}”对应的智能体。',
        agentCommandDuringRun: '请等待当前运行结束后再切换智能体。',
        setReasoningEffort: '更新思考强度失败。',
        compactRequiresConversation: '请先打开一个对话再压缩上下文。',
        compactDuringRun: '请等待当前运行结束后再压缩上下文。',
        compact: '压缩上下文失败。'
      },
      runNotice: {
        retry: {
          title: '正在重试…（第 {{count}} 次重试）',
          titleWithMax: '正在重试…（第 {{count}} 次重试，最多 {{max}} 次）'
        },
        aborted: {
          title: '已由用户停止'
        },
        error: {
          title: '运行失败',
          stale: '（先前的运行）',
          retryAction: '重试',
          dismissAction: '关闭',
          summary: {
            attempts: '{{count}} 次尝试'
          },
          boolean: {
            yes: '是',
            no: '否'
          },
          reason: {
            maxRetriesExceeded: '已达到最大重试次数',
            errorNotRetryable: '错误不可重试',
            abort: '已中止'
          },
          detail: {
            name: '名称',
            provider: '服务商',
            modelId: '模型',
            statusCode: '状态码',
            retryable: '可重试',
            attempts: '尝试次数',
            reason: '原因',
            toolName: '工具',
            toolCallId: '工具调用',
            cause: '底层原因',
            message: '错误消息'
          },
          kind: {
            api: '服务商请求失败',
            retry: '重试已耗尽',
            abort: '运行已取消',
            configuration: '配置错误',
            validation: '请求无效',
            model: '模型不可用',
            provider: '服务商不可用',
            tool: '工具调用失败',
            stream: '流式传输错误',
            content: '未生成内容',
            download: '下载失败',
            unsupported: '不支持的操作',
            unknown: '运行失败'
          }
        }
      }
    },
    policy: {
      notifications: {
        modeChanged: '权限模式已更新',
        modeChangeFailed: '无法更改权限模式',
        ruleSaved: '策略规则已保存',
        ruleSaveFailed: '无法保存策略规则',
        decisionRevoked: '授权已撤销',
        decisionRevokeFailed: '无法撤销授权'
      }
    },
    common: {
      actions: {
        toggle: '切换',
        toggleSidebar: '切换侧边栏',
        close: '关闭',
        back: '返回',
        goBack: '返回上一页',
        refresh: '刷新',
        refreshing: '刷新中…',
        cancel: '取消',
        update: '更新',
        save: '保存',
        saved: '已保存',
        saving: '保存中...',
        selectOption: '选择选项',
        remove: '移除',
        delete: '删除',
        edit: '编辑',
        import: '导入',
        copy: '复制',
        prev: '上一页',
        next: '下一页'
      },
      search: {
        placeholder: '搜索',
        clearFilters: '清除筛选'
      },
      metrics: {
        total: '总数'
      },
      pagination: {
        showing: '显示第 {{start}}–{{end}} 项，共 {{total}} 项',
        goToPage: '第 {{page}} 页'
      },
      status: {
        configured: '已配置',
        notConfigured: '未配置',
        enabled: '已启用',
        disabled: '已禁用',
        connected: '已连接',
        error: '错误',
        changes: '已修改 {{count}} 项',
        loading: '加载中'
      },
      empty: {
        noResults: '暂无匹配结果',
        noResultsWithQuery: '未找到“{{query}}”的匹配结果',
        adjustSearch: '试试换个搜索词或筛选条件。'
      },
      layout: {
        resizeSidebar: '调整侧边栏宽度'
      },
      window: {
        close: '关闭窗口',
        minimize: '最小化窗口',
        maximize: '最大化窗口',
        restore: '还原窗口'
      }
    },
    gitReview: {
      title: '工作区 Git',
      confirmTitle: '恢复文件？',
      confirmBody: '这会丢弃当前更改，并将文件恢复到最近一次提交的状态。',
      confirmAction: '恢复',
      tabs: {
        changes: '更改',
        sync: '同步',
        branches: '分支',
        history: '历史'
      },
      actions: {
        commit: '提交',
        amend: '修补提交',
        stage: '暂存',
        stageAll: '全部暂存',
        unstage: '取消暂存',
        unstageAll: '全部取消暂存',
        restore: '丢弃',
        options: '选项',
        fetch: '抓取',
        pull: '拉取',
        push: '推送',
        forcePush: '强制推送',
        checkout: '检出',
        track: '跟踪',
        create: '创建',
        addRemote: '添加远程',
        initialize: '初始化'
      },
      branch: {
        local: '本地',
        remote: '远程',
        current: '当前',
        localKind: '本地分支',
        remoteKind: '远程分支',
        choose: '选择一个分支',
        detachedHead: '游离 HEAD',
        newBranch: '新分支名称',
        from: '起点（可选）'
      },
      commit: {
        message: '提交信息',
        previousMessage: '复用上次的信息',
        options: {
          amend: '修补',
          noEdit: '保留信息',
          signoff: '署名'
        }
      },
      counts: {
        staged_one: '已暂存 {{count}}',
        staged_other: '已暂存 {{count}}',
        files_one: '{{count}} 个文件',
        files_other: '{{count}} 个文件',
        filesWithUntracked_one: '{{count}} 个文件 · {{untracked}} 个新增',
        filesWithUntracked_other: '{{count}} 个文件 · {{untracked}} 个新增',
        conflicts_one: '{{count}} 个冲突',
        conflicts_other: '{{count}} 个冲突',
        changed_one: '{{count}} 处更改',
        changed_other: '{{count}} 处更改'
      },
      diff: {
        binary: '二进制',
        binaryUnavailable: '二进制文件 — 无法预览',
        loading: '正在加载差异…',
        noTextual: '没有文本更改',
        truncated: '差异已截断'
      },
      identity: {
        title: 'Git 身份',
        name: '姓名',
        email: '邮箱',
        local: '本地',
        global: '全局',
        set: '设置 Git 身份',
        setShort: '设置身份',
        edit: '编辑 Git 身份'
      },
      init: {
        noRepository: '不是 Git 仓库',
        unavailable: 'Git 不可用',
        detail: '初始化仓库以开始跟踪更改。',
        statusUnavailable: '此工作区的 Git 状态不可用。',
        initialBranch: '初始分支'
      },
      review: {
        workingTree: '工作区',
        stagedTab: '已暂存',
        conflicts: '冲突'
      },
      scopes: {
        staged: '已暂存',
        workingTree: '工作区'
      },
      states: {
        clean: '工作区干净',
        empty: '没有已暂存的更改',
        selectFile: '选择文件查看差异',
        selectBranch: '选择一个分支',
        selectCommit: '选择一个提交',
        notInitialized: '无仓库',
        unknown: '未知'
      },
      sync: {
        remotes: '远程',
        noRemotes: '未配置远程',
        remoteName: '远程名称',
        remoteUrl: '远程地址',
        remote: '远程',
        branch: '分支',
        noUpstream: '无上游',
        forceWithLease: '带租约强制推送',
        lease: '租约引用（可选）'
      },
      history: {
        noSubject: '（无信息）',
        pickCommit: '选择提交'
      },
      push: {
        confirmTitle: '推送到远程？',
        confirmBody: '这会把你的本地提交推送到 {{target}}。推送后的提交将发布到远程。',
        forceWarning: '带租约的强制推送可能覆盖远程上的提交，且不易撤销。'
      },
      changePreview: {
        files_one: '{{count}} 个文件改动',
        files_other: '{{count}} 个文件改动',
        restoreBefore: '撤销',
        restoreAfter: '重做',
        loadingPatch: '正在加载差异…',
        noPatchPreview: '无差异预览',
        pageStatus: '第 {{page}} / {{pageCount}} 页',
        confirmTitle: '恢复文件？',
        confirmBody: '这会覆盖这些文件的当前内容。',
        confirmAction: '恢复',
        status: {
          materialized: '已应用',
          pending: '待定',
          partial: '部分',
          failed: '已偏离',
          skipped: '已撤销',
          unknown: '未知'
        },
        kind: {
          added: '新增',
          modified: '修改',
          deleted: '删除',
          renamed: '重命名',
          copied: '复制',
          binary: '二进制'
        }
      },
      errors: {
        refreshStatus: '刷新 Git 状态失败。',
        loadFileDiff: '加载文件差异失败。',
        loadCommitDetails: '加载提交详情失败。',
        loadCommitDiff: '加载提交差异失败。',
        initializeRepository: '初始化仓库失败。',
        stageFile: '暂存文件失败。',
        stageFiles: '暂存文件失败。',
        unstageFile: '取消暂存文件失败。',
        unstageFiles: '取消暂存文件失败。',
        restoreFile: '恢复文件失败。',
        restoreFiles: '恢复文件失败。',
        discardFile: '丢弃文件失败。',
        commitMessageRequired: '请填写提交信息。',
        createCommit: '创建提交失败。',
        fetch: '抓取失败。',
        pull: '拉取失败。',
        push: '推送失败。',
        checkoutBranch: '检出分支失败。',
        checkoutRemoteBranch: '检出远程分支失败。',
        branchNameRequired: '请填写分支名称。',
        createBranch: '创建分支失败。',
        deleteBranch: '删除分支失败。',
        addRemote: '添加远程失败。',
        removeRemote: '移除远程失败。',
        saveIdentity: '保存 Git 身份失败。'
      },
      badges: {
        conflict: '冲突'
      },
      aria: {
        stageFile: '暂存 {{path}}',
        unstageFile: '取消暂存 {{path}}',
        restoreFile: '丢弃对 {{path}} 的更改'
      }
    },
    providers: {
      page: {
        title: '模型服务',
        actions: {
          docs: '文档说明'
        },
        search: {
          placeholder: '搜索模型服务'
        },
        sections: {
          available: {
            title: '待配置'
          }
        },
        errors: {
          notFound: '未找到该模型服务。',
          notFoundTitle: '未找到模型服务',
          loadFailed: '加载模型服务失败，请稍后重试。',
          loadFailedTitle: '模型服务加载失败'
        },
        loading: {
          detail: '正在加载模型服务...'
        },
        tabs: {
          api: '凭证'
        },
        filters: {
          status: {
            label: '状态'
          },
          family: {
            label: '模态'
          }
        },
        empty: {
          title: '暂无匹配的模型服务',
          description: '试试换个搜索词或筛选条件。'
        }
      },
      status: {
        ready: '已就绪',
        expired: '连接验证失败',
        connectedNoModels: '已连接，下一步请同步模型',
        modelsNotEnabled: '模型已同步，启用后即可使用'
      },
      notifications: {
        connectionSaved: '模型服务连接已保存。',
        connectionSaveFailed: '保存模型服务连接失败。',
        connectionTestPassed: '连接测试通过。',
        connectionTestFailed: '连接测试失败。',
        disconnected: '模型服务已断开连接。',
        disconnectFailed: '断开模型服务失败。',
        reset: '模型服务已重置。',
        resetFailed: '重置模型服务失败。',
        apiKeyAdded: 'API Key 已添加。',
        apiKeyAddFailed: '添加 API Key 失败。',
        apiKeyUpdated: 'API Key 已更新。',
        apiKeyUpdateFailed: '更新 API Key 失败。',
        apiKeyDeleted: 'API Key 已删除。',
        apiKeyDeleteFailed: '删除 API Key 失败。',
        activeApiKeyChanged: '当前 API Key 已切换。',
        activeApiKeyChangeFailed: '切换当前 API Key 失败。',
        modelsSynced: '已同步 {{count}} 个 {{family}} 模型。',
        modelsSyncFailed: '同步模型失败。',
        modelStateSaveFailed: '保存模型状态失败。',
        defaultsSaved: '默认值已保存。',
        defaultsSaveFailed: '保存默认值失败。'
      },
      credentials: {
        connection: {
          title: '连接',
          description: '在这里保存公开的端点设置。敏感信息会保留在主进程中。',
          apiKeyOnly: '该模型服务只使用 API Key。'
        },
        test: {
          button: '测试连接'
        },
        encryption: {
          unavailable: '加密不可用'
        },
        apiKeys: {
          title: 'API Key 环',
          description: '独立添加和轮换密钥。',
          empty: '暂无 API Key',
          add: '添加 API 密钥',
          active: '当前',
          use: '使用',
          labelPlaceholder: '标签'
        },
        fields: {
          apiKey: {
            label: 'API Key'
          }
        }
      },
      models: {
        list: {
          title: '模型',
          enabledCount: '已启用 {{enabled}}/{{total}}',
          sync: '同步',
          empty: '尚未同步模型。'
        },
        badges: {
          custom: '自定义'
        },
        actions: {
          setDefault: '设为默认',
          default: '默认'
        },
        pagination: {
          showing: '显示第 {{start}}–{{end}} 项，共 {{total}} 项'
        },
        add: {
          button: '添加模型',
          title: '添加自定义模型',
          description: '手动添加模型 ID，用于尚未自动同步的模型。',
          success: '模型已添加',
          error: '添加模型失败',
          submit: '添加模型',
          cancel: '取消',
          fields: {
            id: {
              label: '模型 ID',
              placeholder: '例如 gpt-4o-mini'
            },
            name: {
              label: '显示名称',
              placeholder: '可选，默认使用模型 ID'
            },
            contextWindow: {
              label: '上下文窗口',
              placeholder: '必填，Token 数'
            },
            maxOutput: {
              label: '最大输出',
              placeholder: '必填，Token 数'
            }
          }
        },
        edit: {
          title: '编辑模型',
          description: '更新模型的显示名称、上下文窗口和最大输出。',
          submit: '保存更改',
          cancel: '取消'
        },
        delete: {
          title: '删除模型',
          description:
            '确定要从本地列表删除“{{name}}”吗？这不会影响模型服务中的模型，后续同步可能会再次拉回。',
          success: '模型已删除',
          error: '删除模型失败'
        },
        bulk: {
          enableAll: '全部开启',
          disableAll: '全部关闭'
        },
        meta: {
          contextWindow: '{{value}} 上下文',
          maxOutput: '{{value}} 输出',
          dimensions: '{{value}} 维',
          images: '{{value}} 张图片'
        }
      },
      family: {
        labels: {
          language: '文本生成',
          embedding: '嵌入',
          image: '图像生成',
          transcription: '语音转写',
          speech: '语音合成'
        },
        unavailable: '该模型服务不提供 {{family}} 设置。'
      },
      defaults: {
        title: '默认值',
        description: '保存未来运行时使用的调用默认值和模型服务专属选项。',
        unset: '未设置',
        callDefaults: {
          label: '调用默认值 JSON',
          description: '常用调用参数，例如 temperature 或 maxOutputTokens。'
        },
        rawProviderOptions: {
          label: '原始 providerOptions JSON',
          description: '高级兜底入口。原始值会覆盖结构化选项。'
        },
        reset: {
          button: '重置',
          title: '重置参数配置',
          description:
            '确定要将该模型分类下的所有参数默认值恢复为系统默认吗？已保存的调用默认值和选项都会被清空，此操作无法撤销。',
          confirm: '重置'
        },
        errors: {
          objectRequired: 'JSON 值必须是对象。'
        }
      }
    },
    settings: {
      page: {
        title: '设置',
        tabs: {
          theme: '主题',
          permissions: '权限',
          hooks: '钩子',
          pet: '桌面宠物',
          tools: '工具',
          about: '关于'
        }
      },
      about: {
        tagline: 'AI 原生桌面工作台，为规划、编码与自动化而生。',
        copy: '复制信息',
        copied: '已复制',
        license: '基于 Apache-2.0 许可证发布',
        links: {
          issues: '反馈问题'
        },
        update: {
          available: '更新到 {{version}}',
          downloading: '下载中… {{percent}}%',
          ready: '重启以完成更新',
          error: '检查更新失败'
        }
      },
      tools: {
        intro: '为 agent 开启或关闭内置工具。关闭的工具会从所有 agent（包括子代理）中移除。',
        enabledCount: '{{count}}/{{total}}',
        toggleCategory: '开关此类别的所有工具',
        readOnly: '只读',
        locked: '必需',
        categories: {
          files: {
            title: '文件',
            description: '读取和编辑工作区文件。'
          },
          search: {
            title: '搜索',
            description: '查找文件、搜索文件内容。'
          },
          shell: {
            title: 'Shell',
            description: '执行 shell 命令，支持前台与后台会话。'
          },
          agent: {
            title: 'Agent',
            description: '技能、任务清单、提问与目标更新。'
          },
          subagents: {
            title: '子代理',
            description: '派生和管理并发的子代理任务。'
          },
          core: {
            title: '核心',
            description: '循环关键工具，始终开启。列出仅为透明可见。'
          }
        },
        browserAutomation: {
          title: '浏览器自动化',
          description: '允许 agent 操控内置浏览器：打开页面、读取、填表、点击、截图。',
          restartNote: 'Agent 访问已关闭。重启 Tanzo 后，浏览器调试端口将完全关闭。',
          connecting: 'chrome-devtools 服务器连接后，浏览器驱动工具会显示在这里。'
        },
        mcp: {
          intro:
            '来自已连接 MCP 服务器的工具。关闭某个工具会对 agent 隐藏它；整个服务器请在 MCP 设置中管理。',
          serverDescription: 'MCP 服务器工具'
        },
        descriptions: {
          fileRead: '按行读取文件的一段内容。',
          fileEdit: '替换文件中的精确文本。',
          multiEdit: '对单个文件原子地应用多处有序编辑。',
          fileWrite: '创建或覆盖文件。',
          glob: '按 glob 模式查找文件。',
          grep: '用 ripgrep 搜索文件内容。',
          shell: '执行 shell 命令。',
          shellStart: '在后台启动长时间运行的 shell 命令。',
          shellPoll: '读取后台 shell 会话的新输出。',
          shellWrite: '向后台 shell 会话发送输入。',
          shellStop: '停止后台 shell 会话。',
          shellList: '列出后台 shell 会话。',
          skill: '加载可用技能的完整说明。',
          todo: '为多步骤工作维护任务清单。',
          askQuestion: '用可点选项向用户提出阻塞式问题。',
          updateGoal: '将长期目标标记为完成或受阻。',
          spawn: '派生并发的子代理任务。',
          await: '等待子代理任务完成。',
          tasks: '查看子代理任务状态。',
          steer: '调整正在运行的子代理任务。',
          cancel: '取消子代理任务。',
          report: '子代理通过它汇报进度和结果。',
          exitPlanMode: '提交计划供批准并退出规划模式。'
        }
      },
      permissions: {
        empty: '尚未保存任何规则。',
        emptyDescription: '从审批提示中保存的权限决定会显示在这里。'
      },
      hooks: {
        title: '钩子',
        description: '在 Agent 生命周期事件运行脚本。兼容 Codex / Claude Code 的 hooks.json。',
        reload: '重新加载',
        summaryTotal: '{{count}} 个钩子',
        summaryUntrusted: '{{count}} 个待授信',
        summaryConfig: '.tanzo/hooks.json · ~/.tanzo/hooks.json',
        empty: '尚未配置任何钩子。',
        emptyHint: '在项目中添加 .tanzo/hooks.json（或全局 ~/.tanzo/hooks.json），然后重新加载。',
        matchAll: '*',
        statusActive: '生效中',
        statusInactive: '未生效',
        preview: '测试',
        previewResult: '退出码 {{code}} · {{ms}}ms',
        previewFailed: '钩子测试失败。',
        trustAction: '授信',
        trust: {
          managed: '受管',
          trusted: '已授信',
          modified: '已改动',
          untrusted: '未授信'
        }
      },
      pet: {
        title: '桌面宠物',
        description: '显示一个浮动伙伴，实时反映 agent 的活动状态。',
        enable: '启用桌面宠物',
        choose: '宠物',
        chooseDescription: '选择出现在桌面上的伙伴。',
        empty: '未找到用户宠物或内置宠物',
        size: {
          title: '尺寸',
          description: '在屏幕上放大或缩小宠物。'
        },
        page: '第 {{page}} / {{pageCount}} 页'
      },
      language: {
        title: '语言',
        description: '选择 Tanzo 在应用内使用的语言。',
        options: {
          en: {
            label: '英文',
            description: '使用英文界面与提示信息。'
          },
          zhCN: {
            label: '简体中文',
            description: '使用简体中文界面与提示信息。'
          }
        }
      },
      theme: {
        appearance: {
          title: '外观',
          description: '设置主题和显示偏好。',
          mode: {
            light: {
              label: '浅色',
              description: '适合明亮环境。'
            },
            dark: {
              label: '深色',
              description: '适合低光环境。'
            },
            system: {
              label: '跟随系统',
              description: '跟随系统外观。'
            }
          }
        },
        reasoning: {
          title: '思考标签',
          description: '控制聊天里的 thinking / reasoning 标签默认是否展开。',
          expand: {
            label: '默认展开思考标签',
            description: '应用到 thinking 和 reasoning 这两种 XML 标签。'
          }
        },
        colors: {
          title: '配色主题',
          description: '选择界面的强调配色。',
          actions: {
            import: '导入主题',
            remove: '移除'
          },
          import: {
            placeholder: '粘贴 tweakcn 主题链接',
            error: '导入失败',
            errors: {
              invalidUrl: '主题链接无效。',
              httpsRequired: '主题链接必须使用 https。',
              fetchFailed: '获取失败：{{status}}',
              tooLarge: '主题响应内容过大。',
              invalidJson: '主题响应不是有效的 JSON。',
              noVariables: '响应中未找到 tweakcn 主题颜色变量。'
            }
          },
          options: {
            tanzo: {
              label: 'Tanzo',
              description: '平衡克制的中性色调。'
            },
            vercel: {
              label: 'Vercel',
              description: '对比更鲜明的中性色调。'
            },
            claude: {
              label: 'Claude',
              description: '偏暖的中性色调，带一点琥珀焦点。'
            },
            supabase: {
              label: 'Supabase',
              description: '偏冷的绿色调和柔和表面。'
            },
            twitter: {
              label: 'Twitter',
              description: '清爽明亮的蓝色调。'
            },
            brutalist: {
              label: 'Brutalist',
              description: '粗野风格：粗边框、高对比、原始质感。'
            }
          }
        },
        wallpaper: {
          title: '背景壁纸',
          description: '建立壁纸库，随时切换背景图片。',
          empty: '尚未添加壁纸。',
          add: '添加',
          activate: '使用此壁纸',
          setDark: '用于深色模式',
          remove: '移除',
          clearAll: '全部清除',
          hint: '点击缩略图以启用。太阳徽章 = 浅色模式，月亮徽章 = 深色模式。悬停可指定深色壁纸或移除。',
          opacity: '不透明度',
          blur: '模糊',
          surfaceOpacity: '面板透明度',
          fit: {
            title: '填充方式',
            options: {
              cover: '填满',
              contain: '适应',
              fill: '拉伸',
              tile: '平铺'
            }
          },
          overlay: {
            title: '遮罩',
            strength: '浓度',
            options: {
              none: '无',
              dark: '暗化',
              light: '亮化'
            }
          }
        },
        typography: {
          title: '排版',
          description: '字体、字号与行高。',
          sansFont: '界面字体',
          monoFont: '代码字体',
          fontSize: '字号',
          codeFontSize: '代码字号',
          lineHeight: '行高',
          themeDefault: '跟随主题',
          bundled: '内置',
          system: '系统',
          sample: '落霞与孤鹜齐飞，秋水共长天一色 — 0123456789',
          search: '搜索字体…',
          noResults: '未找到字体。',
          reset: '重置'
        }
      }
    },
    mcp: {
      elicitation: {
        title: '服务器需要额外输入',
        description: '{{serverName}} 正在请求更多输入。',
        accept: '继续',
        decline: '拒绝',
        noFields: '该请求没有附带结构化字段。',
        booleanLabel: '启用',
        submitError: '提交 MCP 响应失败',
        validation: {
          required: '请填写 {{field}}',
          number: '{{field}} 必须是数字',
          integer: '{{field}} 必须是整数',
          json: '{{field}} 必须是合法 JSON'
        }
      },
      page: {
        title: 'MCP 服务器',
        search: {
          placeholder: '搜索 MCP 服务器'
        },
        empty: {
          title: '还没有 MCP 服务器',
          description: '添加 MCP 服务器，接入工具、提示词和资源。',
          noMatch: {
            title: '暂无匹配的 MCP 服务器',
            description: '试试调整搜索词或筛选条件。'
          }
        },
        filters: {
          status: {
            label: '状态'
          },
          transport: {
            label: '传输方式'
          }
        }
      },
      server: {
        create: {
          button: '添加服务器',
          title: '添加 MCP 服务器'
        },
        edit: {
          title: '编辑 MCP 服务器'
        },
        card: {
          description: {
            command: '通过 {{command}} 启动',
            url: '连接到 {{url}}',
            generic: '已配置 MCP 服务器',
            builtinBrowser:
              '内置浏览器自动化。由 Tanzo 管理；与「设置 → 工具」中的浏览器自动化开关联动。'
          },
          builtinBadge: '内置'
        },
        metrics: {
          toolsCount: '{{count}} 个工具'
        },
        status: {
          connecting: '正在连接...',
          connectionFailed: '连接失败',
          disconnected: '已断开'
        },
        detail: {
          transport: '连接方式',
          server: '服务器',
          createdAt: '添加时间',
          commandConfig: '连接配置',
          command: '启动命令',
          arguments: '启动参数',
          cwd: '工作目录',
          fullCommand: '完整命令',
          url: '服务器地址',
          env: '环境变量',
          tabs: {
            info: '信息',
            tools: '工具',
            prompts: '提示词',
            resources: '资源'
          },
          tools: {
            empty: '此服务器未暴露任何工具。',
            schema: '参数'
          },
          prompts: {
            empty: '此服务器未暴露任何提示词。',
            arguments: '参数',
            required: '必填',
            optional: '可选'
          },
          resources: {
            empty: '此服务器未暴露任何资源。'
          },
          reconnect: '重新连接',
          reconnecting: '正在重连...',
          notConnected: '服务器未连接。',
          notConnectedDescription: '连接服务器后即可查看其工具、提示词和资源。'
        },
        form: {
          addServer: '添加服务器',
          name: {
            label: '服务器名称',
            placeholder: '我的 MCP 服务器'
          },
          description: {
            label: '描述',
            placeholder: '例如：提供文件读写与目录浏览能力'
          },
          transport: '连接方式',
          command: '启动命令',
          cwd: '工作目录',
          arguments: {
            label: '启动参数',
            placeholder: '--flag value',
            help: '多个参数请用空格分隔'
          },
          url: {
            label: '服务器地址',
            placeholder: 'https://example.com/mcp'
          },
          headers: {
            label: '请求头（JSON）',
            placeholder: '{ "Authorization": "Bearer ..." }'
          },
          redirect: {
            label: '重定向',
            follow: '跟随重定向',
            error: '重定向时报错'
          },
          env: {
            label: '环境变量（JSON）',
            placeholder: '{ "API_KEY": "..." }'
          },
          quickStart: '快速接入',
          template: {
            placeholder: '选择预设模板'
          },
          import: {
            action: '导入 JSON 配置',
            placeholder: '在此粘贴 JSON'
          },
          errors: {
            invalidJson: '无效的 JSON',
            jsonInvalid: '{{field}} 必须是有效的 JSON 对象。',
            jsonNotObject: '{{field}} 必须是 JSON 对象。',
            jsonValuesString: '{{field}} 的所有值都必须是字符串。'
          }
        },
        delete: {
          title: '删除 MCP 服务器？',
          description: '删除后将移除 {{name}} 的连接和配置。'
        },
        templates: {
          filesystem: {
            name: '文件系统',
            description: '访问本地文件和目录'
          },
          chromeDevtools: {
            name: 'Chrome DevTools',
            description: '通过 Chrome DevTools 协议执行浏览器自动化'
          },
          everything: {
            name: 'Everything',
            description: '包含提示词、资源、工具和补全能力的参考服务器'
          }
        },
        notifications: {
          createSuccess: '服务器已添加',
          createError: '添加服务器失败',
          updateSuccess: '服务器已更新',
          updateError: '更新服务器失败',
          deleteSuccess: '服务器已删除',
          deleteError: '删除服务器失败',
          toggleSuccess: '服务器{{state}}',
          toggleError: '更新服务器状态失败',
          reconnectSuccess: '正在重新连接服务器',
          reconnectError: '重新连接服务器失败'
        }
      },
      transport: {
        stdio: 'stdio',
        sse: 'SSE',
        http: 'HTTP'
      }
    },
    pet: {
      quickInput: {
        placeholder: '发送消息…',
        send: '发送',
        sendShortcut: '发送 · Enter'
      },
      approval: {
        title: '需要权限确认'
      },
      reply: {
        title: 'Tanzo 回复了',
        open: '打开'
      }
    },
    plugins: {
      page: {
        title: '插件',
        search: {
          placeholder: '搜索插件'
        },
        stats: {
          installed: '已安装',
          enabled: '已启用',
          available: '可用'
        },
        actions: {
          reload: '重新加载'
        },
        sections: {
          installed: '已安装',
          available: '可从市场安装',
          availableFrom: '{{name}} 市场'
        },
        empty: {
          title: '未找到插件',
          description:
            'Tanzo 会从 ~/.agents/plugins 和当前工作区的 .agents/plugins 中的 marketplace.json 发现插件。'
        }
      },
      status: {
        error: '错误'
      },
      contributes: {
        skills: '技能',
        mcp: '{{count}} 个 MCP 服务器',
        hooks: '钩子'
      },
      card: {
        noDescription: '暂无描述。'
      },
      detail: {
        version: '版本',
        category: '分类',
        path: '路径',
        contributes: '贡献',
        skillsPrefix: '技能前缀为',
        hooksActive: '生命周期钩子已激活',
        noContributions: '该插件未贡献任何技能、MCP 服务器或钩子。',
        mentionHint: '在对话中输入 @{{name}} 可让模型在该回合优先使用此插件。',
        about: '关于',
        keywords: '关键词'
      },
      actions: {
        install: '安装',
        toggle: '切换插件',
        uninstall: '卸载'
      },
      uninstall: {
        title: '卸载插件？',
        description: '这将从缓存中移除 “{{name}}” 及其贡献的技能、MCP 服务器和钩子。',
        confirm: '卸载'
      },
      toast: {
        installed: '插件已安装',
        uninstalled: '插件已卸载',
        updateFailed: '更新插件失败',
        installFailed: '安装插件失败',
        uninstallFailed: '卸载插件失败',
        reloadFailed: '重新加载插件失败'
      },
      marketplace: {
        add: {
          action: '添加市场',
          title: '添加市场',
          source: {
            label: '来源',
            placeholder: 'owner/repo、git URL 或本地路径',
            hint: 'GitHub 简写（owner/repo）、git/SSH URL，或包含 marketplace.json 的本地目录。'
          },
          ref: {
            label: '分支/标签',
            placeholder: '分支、标签或提交'
          },
          sparse: {
            label: '稀疏路径',
            placeholder: '以逗号分隔的路径'
          },
          submit: '添加',
          errors: {
            sourceRequired: '请输入市场来源。',
            addFailed: '添加市场失败'
          }
        },
        manage: {
          action: '市场',
          title: '市场',
          type: {
            git: 'Git',
            local: '本地'
          },
          actions: {
            upgrade: '更新',
            remove: '移除'
          },
          empty: {
            title: '尚未添加市场',
            description: '添加 git 或本地市场，发现默认 ~/.agents/plugins 和工作区目录之外的插件。'
          }
        },
        toast: {
          added: '已添加市场 “{{name}}”',
          alreadyAdded: '市场 “{{name}}” 已添加',
          removed: '已移除市场 “{{name}}”',
          removeFailed: '移除市场失败',
          upgraded: '已更新市场 “{{name}}”',
          upToDate: '市场 “{{name}}” 已是最新',
          upgradeFailed: '更新市场失败'
        }
      }
    },
    skills: {
      page: {
        title: '技能',
        search: {
          placeholder: '搜索技能'
        },
        stats: {
          skills: '技能',
          enabled: '已启用',
          installed: '已安装'
        },
        actions: {
          install: '安装',
          reload: '重新扫描'
        },
        empty: {
          title: '未找到技能',
          description: 'Tanzo 会扫描当前工作区的 .tanzo/skills 与 .claude/skills 以及用户技能目录。'
        }
      },
      filters: {
        scope: { label: '范围' },
        status: { label: '状态' },
        source: { label: '来源' }
      },
      scope: {
        user: '用户',
        workspace: '工作区',
        builtin: '内置',
        plugin: '插件'
      },
      status: {
        enabled: '已启用',
        disabled: '已停用'
      },
      source: {
        installed: '已安装',
        scanned: '已扫描',
        localInstall: '本地安装'
      },
      card: {
        toggleAria: '切换 {{name}}',
        toolCount: '{{count}} 个工具'
      },
      detail: {
        badges: {
          enabled: '已启用',
          disabled: '已停用',
          installed: '已安装'
        },
        uninstall: '卸载',
        sections: {
          details: '详情'
        },
        fields: {
          name: '名称',
          source: '来源',
          model: '模型',
          license: '许可证',
          allowedTools: '允许的工具',
          path: '路径'
        },
        values: {
          none: '无',
          allTools: '全部'
        },
        body: {
          title: '技能内容',
          empty: '暂无内容。'
        }
      },
      install: {
        title: '安装技能',
        directory: {
          label: '技能目录',
          placeholder: '/path/to/skill',
          choose: '选择',
          hint: '该目录必须包含带 name 和 description 的 SKILL.md 文件。'
        },
        scope: {
          label: '目标范围',
          user: '用户',
          workspace: '工作区'
        },
        options: {
          label: '选项',
          enableAfterInstall: '安装后启用',
          replaceExisting: '覆盖已存在的目标'
        },
        submit: '安装',
        errors: {
          chooseFirst: '请先选择一个本地技能目录。',
          installFailed: '安装失败',
          chooseDir: '无法选择技能目录'
        }
      },
      uninstall: {
        title: '卸载技能？',
        description: '已安装的文件和保存的状态都将被移除。',
        confirm: '卸载',
        cancel: '取消'
      },
      toast: {
        installed: '技能已安装',
        uninstalled: '技能已卸载',
        updateFailed: '更新技能失败',
        uninstallFailed: '卸载失败',
        reloadFailed: '重新扫描失败'
      }
    }
  }
} as const
