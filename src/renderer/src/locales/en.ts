export const en = {
  translation: {
    nav: {
      groups: {
        workspace: 'Workspace',
        system: 'System'
      },
      items: {
        chat: 'Chat',
        skills: 'Skills',
        plugins: 'Plugins',
        providers: 'Providers',
        mcp: 'MCP Servers',
        usage: 'Usage',
        settings: 'Settings'
      }
    },
    browser: {
      toggle: 'Toggle browser',
      back: 'Back',
      forward: 'Forward',
      reload: 'Reload',
      maximize: 'Maximize',
      restore: 'Restore split view',
      close: 'Close browser',
      address: 'Address',
      addressPlaceholder: 'Search or enter address',
      clear: 'Clear',
      error: {
        title: "This page couldn't be loaded",
        code: 'Error {{code}}',
        retry: 'Try again'
      },
      tabs: {
        new: 'New tab',
        close: 'Close tab'
      },
      picker: {
        pick: 'Pick element',
        picking: 'Click an element… (Esc to cancel)',
        copyAll: 'Copy all',
        copied: 'Copied',
        closePanel: 'Close panel',
        groups: {
          color: 'Color',
          typography: 'Typography',
          layout: 'Layout',
          spacing: 'Spacing',
          border: 'Border',
          effects: 'Effects'
        },
        fields: {
          textColor: 'Text',
          background: 'Background',
          gradient: 'Gradient',
          borderColor: 'Border',
          fontFamily: 'Family',
          fontSize: 'Size',
          fontWeight: 'Weight',
          lineHeight: 'Line height',
          letterSpacing: 'Tracking',
          textAlign: 'Align',
          textTransform: 'Transform',
          display: 'Display',
          flexDirection: 'Direction',
          justifyContent: 'Justify',
          alignItems: 'Align items',
          padding: 'Padding',
          margin: 'Margin',
          gap: 'Gap',
          borderWidth: 'Width',
          borderStyle: 'Style',
          borderRadius: 'Radius',
          opacity: 'Opacity',
          boxShadow: 'Shadow',
          filter: 'Filter',
          backdropFilter: 'Backdrop',
          transform: 'Transform'
        }
      }
    },
    usage: {
      page: {
        title: 'Usage'
      },
      stats: {
        conversations: 'conversations',
        runs: 'runs'
      },
      range: {
        '24h': '24h',
        '7d': '7 days',
        '30d': '30 days',
        all: 'All time'
      },
      kpis: {
        totalTokens: 'Total tokens',
        tokensLead: 'Across all runs',
        tokensHint: '{{runs}} runs',
        inputTokens: 'Input tokens',
        inputLead: 'Prompt + context',
        outputTokens: 'Output tokens',
        outputLead: 'Generated',
        outputHint: 'Model completions',
        cacheHitRatio: 'Cache hit rate',
        cacheLeadGood: 'Caching is paying off',
        cacheLeadLow: 'Low cache reuse',
        cacheHint: 'read {{read}} · write {{write}}'
      },
      models: {
        title: 'By model',
        model: 'Model',
        runs: 'Runs',
        input: 'Input',
        output: 'Output',
        total: 'Total'
      },
      charts: {
        trend: 'Token usage over time',
        trendHint: 'Input vs output tokens per bucket',
        input: 'Input',
        output: 'Output'
      },
      runs: {
        title: 'Conversations',
        summary: '{{runs}} runs · {{total}} tokens',
        prev: 'Prev',
        next: 'Next',
        first: 'First page',
        last: 'Last page',
        untitled: 'Untitled'
      },
      table: {
        caption: 'Token usage by conversation. Open one to see per-step detail.',
        columns: 'Columns',
        conversation: 'Conversation',
        runs: 'Runs',
        lastRun: 'Last run',
        noResults: 'No conversations match this view.',
        showing: 'Showing {{count}} of {{total}} conversations',
        page: 'Page {{page}} of {{pageCount}}'
      },
      runDetail: {
        empty: 'No detail for this run.',
        steps: 'Steps',
        input: 'Input',
        output: 'Output',
        cacheRead: 'Cache read',
        total: 'Total'
      },
      empty: {
        title: 'No usage yet',
        description: 'Run a chat to start tracking token usage.'
      },
      error: {
        title: 'Could not load usage',
        description: 'Something went wrong reading usage data.'
      }
    },
    chat: {
      page: {
        title: 'Chat'
      },
      sidebar: {
        newConversation: 'New chat',
        openWorkspace: 'Open workspace',
        collapseSidebar: 'Collapse sidebar',
        expandSidebar: 'Expand sidebar',
        empty: 'No conversations',
        emptyState: {
          title: 'No workspaces yet',
          description: 'Open a project folder to start chatting with your codebase.',
          action: 'Open a workspace'
        },
        delete: 'Delete conversation',
        rename: 'Rename',
        newWorkspaceConversation: 'New conversation in this workspace',
        removeWorkspaceAction: 'Remove workspace',
        removeWorkspace: {
          title: 'Remove workspace {{group}}?',
          description:
            'This removes the workspace from the list and permanently deletes {{count}} conversations in it. Files on disk are not deleted.'
        },
        deleteFamily: {
          title: 'Delete this conversation and its branches?',
          description:
            'This conversation and its {{count}} branches will be permanently deleted. This cannot be undone.'
        },
        justNow: 'just now',
        minutesAgo: '{{count}}m ago',
        hoursAgo: '{{count}}h ago',
        yesterday: 'yesterday',
        daysAgo: '{{count}}d ago'
      },
      workspace: {
        pickerTitle: 'Choose a workspace folder'
      },
      composer: {
        modelSelector: {
          pick: 'Pick a model',
          loading: 'Loading models…',
          empty: 'No model',
          emptyHint: 'Connect a provider in Settings to pick a model.',
          searchPlaceholder: 'Search models…',
          selectProvider: 'Select a provider on the left',
          noMatches: 'No matching models',
          tabAgent: 'Agent',
          tabSubagent: 'Subagent'
        },
        defaultPlaceholder: 'Send a message · Enter to send · Shift+Enter for newline',
        steeringPlaceholder:
          'Queue for after this turn · Enter to queue · ⌘/Ctrl+Enter to steer now',
        steer: 'Steer now',
        steerShortcut: 'Steer now · ⌘/Ctrl+Enter',
        queue: 'Queue',
        queueShortcut: 'Queue · Enter',
        queuedTitle: 'Queued messages',
        queuedSteer: 'Steer now',
        removeQueued: 'Remove',
        todoPanel: {
          label: 'Tasks',
          empty: 'No tasks yet'
        },
        attachmentsStreamingDisabled: "Attachments aren't available while a run is active.",
        attachments: {
          attach: 'Attach images',
          remove: 'Remove image',
          tooLarge: 'Image is too large (max 10MB).',
          onlyImages: 'Only image files can be attached.',
          imageTitle: 'image'
        },
        stop: 'Stop',
        send: 'Send',
        sendShortcut: 'Send · Enter',
        permissionModeLabel: 'Permission mode',
        permissionMode: {
          default: {
            label: 'Ask',
            tooltip: 'Ask before each tool call.'
          },
          plan: {
            label: 'Plan',
            tooltip: 'Plan mode: writes are blocked.'
          },
          yolo: {
            label: 'Auto',
            tooltip: 'Auto-approves all tool calls.'
          },
          dangerous: {
            label: 'Danger',
            tooltip: 'Dangerous mode: auto-approves tools and allows paths outside the workspace.'
          }
        },
        reasoningEffort: {
          default: 'auto',
          none: 'none',
          minimal: 'min',
          low: 'low',
          medium: 'med',
          high: 'high',
          xhigh: 'xhigh',
          max: 'max'
        },
        context: {
          saved: 'saved {{tokens}}',
          compacted: 'compacted',
          usageLabel: 'Compaction trigger usage: {{percent}}%',
          usageUnknown: 'Compaction trigger usage: unknown',
          used: '{{percent}}% used',
          left: '{{tokens}} to compact',
          waitingForLiveUsage: 'waiting for live usage',
          compactedToast: 'Context compacted.',
          noCompactNeeded: 'No compaction needed yet.',
          compactAborted: 'Compaction cancelled.',
          compactStale: 'Conversation changed during compaction; nothing was archived.'
        },
        slashCommands: {
          empty: 'No commands found.',
          groups: {
            builtin: 'Actions',
            agent: 'Agent',
            command: 'Commands',
            skill: 'Skills'
          },
          descriptions: {
            compact: 'Compact the conversation context',
            goal: 'Set, change, or clear an autonomous goal',
            agent: 'Switch the current conversation agent'
          }
        },
        mentions: {
          groups: {
            plugin: 'Plugins',
            file: 'Files'
          }
        }
      },
      approval: {
        permissionTitle: 'Permission required',
        pending: 'Pending',
        approve: 'Approve',
        deny: 'Deny',
        bulk: {
          count: '{{count}} pending approvals',
          approveAll: 'Approve all',
          denyAll: 'Deny all'
        },
        reasonPlaceholder: 'Optional reason — visible to the model',
        scope: {
          once: 'Once',
          session: 'This session',
          forever: 'Always'
        },
        target: {
          path: 'Path',
          command: 'Command',
          url: 'URL',
          value: 'Target'
        }
      },
      subagentApproval: {
        title: 'Sub-agent ({{agent}}) needs approval for {{tool}}',
        objective: 'Objective',
        run: 'Run ID',
        phase: 'Phase',
        capabilities: 'Allowed tools',
        allTools: 'all tools',
        suggestion: {
          retry: 'Try another way',
          amend: 'Amend command',
          skip: 'Skip step',
          abort: 'Abort'
        }
      },
      planReview: {
        title: 'Plan ready for review',
        pending: 'Awaiting approval',
        download: 'Download as markdown',
        approveExecute: 'Approve & execute',
        autoRun: 'Auto-run',
        reject: 'Reject',
        approved: 'Approved',
        rejected: 'Rejected'
      },
      question: {
        label: 'Question',
        waiting: 'Waiting for input',
        meta: {
          count_one: '{{count}} question',
          count_other: '{{count}} questions',
          answered: '{{done}}/{{total}} answered',
          discussing: 'Discussing'
        },
        type: {
          single: 'Pick one',
          multi: 'Pick any',
          rank: 'Rank'
        },
        selected_one: '{{count}} selected',
        selected_other: '{{count}} selected',
        ranked_one: '{{count}} ranked',
        ranked_other: '{{count}} ranked',
        ready: 'Ready to send',
        currentReady: 'Ready for next',
        canBrowse: 'You can review first',
        needsAll: 'Answer all questions to send',
        needsAnswer: 'Choose an answer to continue',
        page: 'Question {{current}} of {{total}}',
        previous: 'Back',
        next: 'Next',
        loadingOptions: 'Loading options…',
        decoding: 'Preparing question…',
        customPlaceholder: 'Or type your own answer',
        discuss: 'Discuss first',
        send_one: 'Send answer',
        send_other: 'Send answers',
        noAnswer: 'No answer',
        error: 'Question failed.',
        moveUp: 'Move up',
        moveDown: 'Move down',
        declined: {
          title: 'User chose to discuss first.',
          default: 'No option was selected — continue the conversation instead.'
        }
      },
      message: {
        userMessage: {
          showMore: 'Show more',
          showLess: 'Show less'
        },
        edit: {
          action: 'Edit message',
          send: 'Send',
          cancel: 'Cancel'
        },
        xmlTag: {
          reasoning: 'Reasoning',
          planning: 'Planning',
          observation: 'Observation',
          reflection: 'Reflection',
          response: 'Response'
        },
        tokenUsage: {
          in: 'in',
          out: 'out',
          reason: 'reason',
          cacheRead: 'cache read',
          cacheWrite: 'cache write'
        },
        parts: {
          plan: {
            title: 'Plan',
            status: {
              pending: 'Pending',
              active: 'Active',
              done: 'Done'
            }
          },
          todo: {
            status: {
              pending: 'Pending',
              in_progress: 'In progress',
              completed: 'Done'
            }
          }
        },
        compaction: {
          compacting: 'Compacting context…',
          compacted: 'Context compacted',
          failed: 'Compaction failed',
          autoTag: 'auto',
          summary: 'Compaction summary',
          reduced: 'Reduced raw context {{tokens}}',
          tokens: 'Raw transcript {{before}} → model view {{after}} tokens',
          omitted: 'Omitted {{count}} older message(s).',
          toolPruning: 'Tool-result pruning was applied.'
        },
        subagentResult: {
          status: {}
        },
        streamingIndicator: {
          fallback: 'Working…',
          messages: {
            pullingSignal: 'Pulling together the useful parts...',
            cuttingFluff: 'Trimming the extra noise...',
            plainLanguage: 'Turning this into plain English...',
            straighteningLogic: 'Straightening out the logic...',
            tighteningWording: 'Tightening the wording...',
            deeperPass: 'Taking one deeper pass...',
            actionableAnswer: 'Shaping this into something actionable...',
            skippingDetours: 'Skipping the detours...',
            polishingUsefulBits: 'Polishing the parts that matter...',
            honestAnswer: 'Working toward the clearest answer...',
            nextMove: 'Lining up the next step...',
            untanglingMess: 'Untangling the messy parts...',
            sharpeningConclusion: 'Sharpening the conclusion...',
            reducingAiAftertaste: 'Making it sound more natural...',
            fillingGaps: 'Filling the missing gaps...',
            makingItLand: 'Making the answer land better...',
            almostToThePoint: 'Almost there...',
            finalPolish: 'Adding the final polish...',
            finalDraft: 'Finishing the final draft...',
            notGhosting: 'Still working...'
          }
        },
        copy: {
          action: 'Copy message',
          code: 'Copy code',
          copied: 'Copied'
        },
        fork: {
          badge: 'Fork',
          action: 'Fork from here',
          pending: 'Forking session...',
          placeholder: 'Branching coming soon'
        },
        scrollToBottom: 'Scroll to bottom'
      },
      tool: {
        common: {
          running: 'Running…',
          toggleLineWrap: 'Toggle line wrap',
          error: 'Tool reported an error.',
          decodingInput: 'decoding input'
        },
        status: {
          streaming: 'streaming',
          pending: 'pending',
          awaitingApproval: 'awaiting approval',
          approved: 'approved',
          done: 'done',
          error: 'error',
          denied: 'denied'
        },
        goal: {
          label: 'Goal',
          status: {
            complete: 'complete',
            blocked: 'blocked'
          },
          errors: {
            updateFailed: 'Goal update failed.'
          }
        },
        shell: {
          noOutput: 'No output.',
          noSessions: 'No sessions.',
          stopped: 'stopped',
          exit: {
            running: 'running',
            stopped: 'stopped',
            failed: 'failed',
            timeout: 'timeout',
            aborted: 'aborted'
          },
          errors: {
            commandFailed: 'Command failed.'
          }
        },
        grep: {
          noMatches: 'No matches.',
          truncated: 'Results truncated. Narrow the search or page with offset.',
          matchesCount_one: '{{count}} match',
          matchesCount_other: '{{count}} matches',
          filesCount_one: '{{count}} file',
          filesCount_other: '{{count}} files',
          caseInsensitive: 'case-insensitive',
          multiline: 'multiline',
          errors: {
            searchFailed: 'Search failed.'
          }
        },
        glob: {
          noMatches: 'No matching files.',
          truncated: 'Result list was truncated. Refine the pattern or page with offset.',
          hitsCount_one: '{{count}} hit',
          hitsCount_other: '{{count}} hits',
          includingIgnored: 'including ignored files',
          errors: {
            globFailed: 'Glob failed.'
          }
        },
        fileRead: {
          lines_one: '{{count}} line',
          lines_other: '{{count}} lines',
          linesPlus: '{{count}}+ lines',
          cells_one: '{{count}} cell',
          cells_other: '{{count}} cells',
          truncated: 'truncated',
          moreAvailable: 'more available',
          errors: {
            readFailed: 'Read failed.'
          }
        },
        fileWrite: {
          errors: {
            writeFailed: 'Write failed.'
          }
        },
        fileEdit: {
          replacements_one: '{{count}} replacement',
          replacements_other: '{{count}} replacements',
          edits_one: '{{count}} edit',
          edits_other: '{{count}} edits',
          replaceAll: 'replace all',
          errors: {
            editFailed: 'Edit failed.'
          }
        },
        dynamic: {
          label: 'Tool',
          input: 'input',
          output: 'output',
          errors: {
            toolFailed: 'Tool failed.'
          }
        },
        todo: {
          label: 'Todo',
          items_one: '{{count}} item',
          items_other: '{{count}} items',
          dropped: 'dropped',
          unfinishedRemoved: 'unfinished items removed',
          errors: {
            updateFailed: 'Todo update failed.'
          }
        },
        skill: {
          label: 'Skill',
          loaded: 'Loaded',
          loading: 'Loading {{skill}}…',
          loadingInstructions: 'Loading instructions…',
          ready: 'Instructions added to this run.',
          instructions: 'Instructions',
          source: 'source',
          args: 'args',
          allTools: 'all tools',
          tools_one: '{{count}} tool',
          tools_other: '{{count}} tools',
          noTools: 'no tools',
          allToolsAllowed: 'all tools allowed',
          errors: {
            activationFailed: 'Skill activation failed.'
          }
        },
        browser: {
          label: 'Browser',
          url: 'url',
          actions: {
            browserOpen: 'Open browser'
          },
          errors: {
            failed: 'Browser action failed.'
          }
        },
        subagent: {
          label: 'Subagent',
          run: 'Subagent',
          action: {
            spawn: 'Handed off',
            await: 'Result from',
            tasks: 'Checked on',
            steer: 'Redirected',
            cancel: 'Stopped',
            report: 'Reported'
          },
          status: {
            pending: 'Pending',
            running: 'Running',
            blocked: 'Blocked',
            done: 'Done',
            failed: 'Failed',
            cancelled: 'Cancelled'
          },
          acked: 'Done.',
          ack: {
            instructed: 'Instruction sent.',
            redefined: 'Objective replaced.',
            cancelled: 'Subagent stopped.',
            phaseReported: 'Phase updated.',
            resultSubmitted: 'Result submitted.'
          },
          noTasks: 'No subagents yet.',
          allTasks: 'All subagents',
          filteredRuns: 'Subagents · {{status}}',
          subagentCount: '{{count}} subagents',
          result: 'Result',
          resultFailed: 'Failed',
          dependsOn: 'Depends on {{tasks}}.',
          blockedDependency: 'Waiting on {{tasks}}.',
          blockedBy: 'Blocked by',
          waitingFor: 'Waiting for',
          blockedApproval: 'Waiting for approval.',
          awaitPending: 'Still running: {{tasks}}.',
          inferred: 'inferred',
          resultInferred:
            'Result inferred from last assistant text — sub-agent did not call report().',
          errors: {
            taskFailed: 'Subagent failed.'
          }
        }
      },
      taskPanel: {
        title: 'Subagents',
        taskCount: '{{count}} total',
        running: 'Running',
        done: 'Done',
        blockedDependency: 'Waiting on {{tasks}}',
        blockedApproval: 'Waiting for approval',
        interrupted: 'Interrupted — app restarted. Use retry to restart.'
      },
      goal: {
        pause: 'Pause goal',
        resume: 'Resume goal',
        clear: 'Clear goal',
        edit: 'Edit objective',
        save: 'Save objective',
        cancelEdit: 'Cancel edit',
        editPlaceholder: 'Goal objective',
        status: {
          active: 'Active',
          paused: 'Paused',
          blocked: 'Blocked',
          budget_limited: 'Budget reached',
          usage_limited: 'Usage limited',
          complete: 'Complete'
        },
        command: {
          current: 'Goal: {{objective}} ({{status}})',
          none: 'No active goal.',
          cleared: 'Goal cleared.',
          paused: 'Goal paused.',
          resumed: 'Goal resumed.',
          objectiveUpdated: 'Goal objective updated.',
          set: 'Goal set.'
        }
      },
      errors: {
        deleteConversation: 'Failed to delete conversation.',
        forkConversation: 'Failed to fork conversation.',
        goalCommand: 'Failed to update goal.',
        startRun: 'Failed to start chat run.',
        setModel: 'Failed to switch model.',
        setAgent: 'Failed to switch agent.',
        renameConversation: 'Failed to rename conversation.',
        agentCommandMissing: 'Usage: /agent <name|id>.',
        agentCommandUnknown: 'No agent found for "{{agent}}".',
        agentCommandDuringRun: 'Wait for the active run to finish before switching agent.',
        setReasoningEffort: 'Failed to update reasoning effort.',
        compactRequiresConversation: 'Open a conversation before compacting context.',
        compactDuringRun: 'Wait for the active run to finish before compacting context.',
        compact: 'Failed to compact context.'
      },
      runNotice: {
        retry: {
          title: 'Retrying… (retry {{count}})',
          titleWithMax: 'Retrying… (retry {{count}}, up to {{max}} retries)'
        },
        error: {
          title: 'Run failed',
          summary: {
            attempts: '{{count}} attempts'
          },
          boolean: {
            yes: 'yes',
            no: 'no'
          },
          reason: {
            maxRetriesExceeded: 'max retries exceeded',
            errorNotRetryable: 'error was not retryable',
            abort: 'aborted'
          },
          detail: {
            name: 'Name',
            provider: 'Provider',
            modelId: 'Model',
            statusCode: 'Status',
            retryable: 'Retryable',
            attempts: 'Attempts',
            reason: 'Reason',
            toolName: 'Tool',
            toolCallId: 'Tool call',
            cause: 'Cause',
            message: 'Message'
          },
          kind: {
            api: 'Provider request failed',
            retry: 'Retries exhausted',
            abort: 'Run cancelled',
            configuration: 'Configuration error',
            validation: 'Invalid request',
            model: 'Model unavailable',
            provider: 'Provider unavailable',
            tool: 'Tool call failed',
            stream: 'Stream error',
            content: 'No content generated',
            download: 'Download failed',
            unsupported: 'Unsupported operation',
            unknown: 'Run failed'
          }
        }
      }
    },
    policy: {
      notifications: {
        modeChanged: 'Permission mode updated',
        modeChangeFailed: 'Could not change permission mode',
        ruleSaved: 'Policy rule saved',
        ruleSaveFailed: 'Could not save policy rule',
        decisionRevoked: 'Approval revoked',
        decisionRevokeFailed: 'Could not revoke approval'
      }
    },
    common: {
      actions: {
        toggle: 'Toggle',
        toggleSidebar: 'Toggle sidebar',
        close: 'Close',
        back: 'Back',
        goBack: 'Go back',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        cancel: 'Cancel',
        update: 'Update',
        save: 'Save',
        saved: 'Saved',
        saving: 'Saving...',
        selectOption: 'Select option',
        remove: 'Remove',
        delete: 'Delete',
        edit: 'Edit',
        import: 'Import',
        copy: 'Copy',
        prev: 'Prev',
        next: 'Next'
      },
      search: {
        placeholder: 'Search',
        clearFilters: 'Clear filters'
      },
      metrics: {
        total: 'Total'
      },
      pagination: {
        showing: 'Showing {{start}}–{{end}} of {{total}}',
        goToPage: 'Go to page {{page}}'
      },
      status: {
        configured: 'Configured',
        notConfigured: 'Not configured',
        enabled: 'Enabled',
        disabled: 'Disabled',
        connected: 'Connected',
        error: 'Error',
        changes: '{{count}} changes',
        loading: 'Loading'
      },
      empty: {
        noResults: 'No matches found',
        noResultsWithQuery: 'No matches for "{{query}}"',
        adjustSearch: 'Try a different search or filter.'
      },
      layout: {
        resizeSidebar: 'Resize sidebar'
      },
      window: {
        close: 'Close window',
        minimize: 'Minimize window',
        maximize: 'Maximize window',
        restore: 'Restore window'
      }
    },
    gitReview: {
      title: 'Workspace Git',
      confirmTitle: 'Restore files?',
      confirmBody:
        'This will discard the current changes and restore the files to their last committed state.',
      confirmAction: 'Restore',
      tabs: {
        changes: 'Changes',
        sync: 'Sync',
        branches: 'Branches',
        history: 'History'
      },
      actions: {
        commit: 'Commit',
        amend: 'Amend',
        stage: 'Stage',
        stageAll: 'Stage all',
        unstage: 'Unstage',
        unstageAll: 'Unstage all',
        restore: 'Discard',
        options: 'Options',
        fetch: 'Fetch',
        pull: 'Pull',
        push: 'Push',
        forcePush: 'Force push',
        checkout: 'Checkout',
        track: 'Track',
        create: 'Create',
        addRemote: 'Add remote',
        initialize: 'Initialize'
      },
      branch: {
        local: 'Local',
        remote: 'Remote',
        current: 'current',
        localKind: 'Local branch',
        remoteKind: 'Remote branch',
        choose: 'Select a branch',
        detachedHead: 'Detached HEAD',
        newBranch: 'New branch name',
        from: 'From (optional)'
      },
      commit: {
        message: 'Commit message',
        previousMessage: 'Reuse previous message',
        options: {
          amend: 'Amend',
          noEdit: 'Keep message',
          signoff: 'Sign off'
        }
      },
      counts: {
        staged_one: '{{count}} staged',
        staged_other: '{{count}} staged',
        files_one: '{{count}} file',
        files_other: '{{count}} files',
        filesWithUntracked_one: '{{count}} file · {{untracked}} new',
        filesWithUntracked_other: '{{count}} files · {{untracked}} new',
        conflicts_one: '{{count}} conflict',
        conflicts_other: '{{count}} conflicts',
        changed_one: '{{count}} changed',
        changed_other: '{{count}} changed'
      },
      diff: {
        binary: 'binary',
        binaryUnavailable: 'Binary file — no preview',
        loading: 'Loading diff…',
        noTextual: 'No textual changes',
        truncated: 'Diff truncated'
      },
      identity: {
        title: 'Git identity',
        name: 'Name',
        email: 'Email',
        local: 'Local',
        global: 'Global',
        set: 'Set Git identity',
        setShort: 'Set identity',
        edit: 'Edit Git identity'
      },
      init: {
        noRepository: 'Not a Git repository',
        unavailable: 'Git unavailable',
        detail: 'Initialize a repository to start tracking changes.',
        statusUnavailable: 'Git status is unavailable for this workspace.',
        initialBranch: 'Initial branch'
      },
      review: {
        workingTree: 'Working tree',
        stagedTab: 'Staged',
        conflicts: 'Conflicts'
      },
      scopes: {
        staged: 'Staged',
        workingTree: 'Working tree'
      },
      states: {
        clean: 'Working tree clean',
        empty: 'Nothing staged',
        selectFile: 'Select a file to view its diff',
        selectBranch: 'Select a branch',
        selectCommit: 'Select a commit',
        notInitialized: 'No repository',
        unknown: 'unknown'
      },
      sync: {
        remotes: 'Remotes',
        noRemotes: 'No remotes configured',
        remoteName: 'Remote name',
        remoteUrl: 'Remote URL',
        remote: 'Remote',
        branch: 'Branch',
        noUpstream: 'No upstream',
        forceWithLease: 'Force with lease',
        lease: 'Lease ref (optional)'
      },
      history: {
        noSubject: '(no message)',
        pickCommit: 'Select commit'
      },
      push: {
        confirmTitle: 'Push to remote?',
        confirmBody:
          'This will push your local commits to {{target}}. Pushed commits are published to the remote.',
        forceWarning:
          'Force-with-lease can overwrite commits on the remote. This may be hard to undo.'
      },
      changePreview: {
        files_one: '{{count}} file changed',
        files_other: '{{count}} files changed',
        restoreBefore: 'Revert',
        restoreAfter: 'Reapply',
        loadingPatch: 'Loading diff…',
        noPatchPreview: 'No diff preview available',
        pageStatus: 'Page {{page}} of {{pageCount}}',
        confirmTitle: 'Restore files?',
        confirmBody: 'This will overwrite the current contents of these files.',
        confirmAction: 'Restore',
        status: {
          materialized: 'Applied',
          pending: 'Pending',
          partial: 'Partial',
          failed: 'Diverged',
          skipped: 'Reverted',
          unknown: 'Unknown'
        },
        kind: {
          added: 'added',
          modified: 'modified',
          deleted: 'deleted',
          renamed: 'renamed',
          copied: 'copied',
          binary: 'binary'
        }
      },
      errors: {
        refreshStatus: 'Failed to refresh Git status.',
        loadFileDiff: 'Failed to load file diff.',
        loadCommitDetails: 'Failed to load commit details.',
        loadCommitDiff: 'Failed to load commit diff.',
        initializeRepository: 'Failed to initialize repository.',
        stageFile: 'Failed to stage file.',
        stageFiles: 'Failed to stage files.',
        unstageFile: 'Failed to unstage file.',
        unstageFiles: 'Failed to unstage files.',
        restoreFile: 'Failed to restore file.',
        restoreFiles: 'Failed to restore files.',
        discardFile: 'Failed to discard file.',
        commitMessageRequired: 'Commit message is required.',
        createCommit: 'Failed to create commit.',
        fetch: 'Failed to fetch.',
        pull: 'Failed to pull.',
        push: 'Failed to push.',
        checkoutBranch: 'Failed to checkout branch.',
        checkoutRemoteBranch: 'Failed to checkout remote branch.',
        branchNameRequired: 'Branch name is required.',
        createBranch: 'Failed to create branch.',
        deleteBranch: 'Failed to delete branch.',
        addRemote: 'Failed to add remote.',
        removeRemote: 'Failed to remove remote.',
        saveIdentity: 'Failed to save Git identity.'
      },
      badges: {
        conflict: 'conflict'
      },
      aria: {
        stageFile: 'Stage {{path}}',
        unstageFile: 'Unstage {{path}}',
        restoreFile: 'Discard changes to {{path}}'
      }
    },
    providers: {
      page: {
        title: 'Providers',
        actions: {
          docs: 'Documentation'
        },
        search: {
          placeholder: 'Search providers'
        },
        sections: {
          available: {
            title: 'Ready to Set Up'
          }
        },
        errors: {
          notFound: "That provider wasn't found.",
          notFoundTitle: 'Provider not found',
          loadFailed: 'Failed to load providers. Please try again.',
          loadFailedTitle: 'Providers failed to load'
        },
        loading: {
          detail: 'Loading provider...'
        },
        tabs: {
          api: 'Credentials'
        },
        filters: {
          status: {
            label: 'Status'
          },
          family: {
            label: 'Family'
          }
        },
        empty: {
          title: 'No matching providers',
          description: 'Try a different search or filter.'
        }
      },
      status: {
        ready: 'Ready',
        expired: 'Connection validation failed',
        connectedNoModels: 'Connected · Sync models next',
        modelsNotEnabled: 'Models synced · Enable one to use it'
      },
      notifications: {
        connectionSaved: 'Provider connection saved.',
        connectionSaveFailed: 'Failed to save provider connection.',
        connectionTestPassed: 'Connection test passed.',
        connectionTestFailed: 'Connection test failed.',
        disconnected: 'Provider disconnected.',
        disconnectFailed: 'Failed to disconnect provider.',
        reset: 'Provider reset.',
        resetFailed: 'Failed to reset provider.',
        apiKeyAdded: 'API key added.',
        apiKeyAddFailed: 'Failed to add API key.',
        apiKeyUpdated: 'API key updated.',
        apiKeyUpdateFailed: 'Failed to update API key.',
        apiKeyDeleted: 'API key deleted.',
        apiKeyDeleteFailed: 'Failed to delete API key.',
        activeApiKeyChanged: 'Active API key changed.',
        activeApiKeyChangeFailed: 'Failed to change active API key.',
        modelsSynced: 'Synced {{count}} {{family}} models.',
        modelsSyncFailed: 'Failed to sync models.',
        modelStateSaveFailed: 'Failed to save model state.',
        defaultsSaved: 'Defaults saved.',
        defaultsSaveFailed: 'Failed to save defaults.'
      },
      credentials: {
        connection: {
          title: 'Connection',
          description: 'Save public endpoint settings here. Secrets stay in the main process.',
          apiKeyOnly: 'This provider only uses API keys.'
        },
        test: {
          button: 'Test connection'
        },
        encryption: {
          unavailable: 'encryption unavailable'
        },
        apiKeys: {
          title: 'API key ring',
          description: 'Add and rotate keys independently.',
          empty: 'No API keys yet',
          add: 'Add API key',
          active: 'active',
          use: 'Use',
          labelPlaceholder: 'Label'
        },
        fields: {
          apiKey: {
            label: 'API key'
          }
        }
      },
      models: {
        list: {
          title: 'Models',
          enabledCount: '{{enabled}}/{{total}} enabled',
          sync: 'Sync',
          empty: 'No models synced yet.'
        },
        badges: {
          custom: 'custom'
        },
        actions: {
          setDefault: 'Set default',
          default: 'Default'
        },
        pagination: {
          showing: 'Showing {{start}}–{{end}} of {{total}}'
        },
        add: {
          button: 'Add model',
          title: 'Add a custom model',
          description: 'Enter a model ID to add it manually.',
          success: 'Model added',
          error: "Couldn't add model",
          submit: 'Add model',
          cancel: 'Cancel',
          fields: {
            id: {
              label: 'Model ID',
              placeholder: 'e.g. gpt-4o-mini'
            },
            name: {
              label: 'Display name',
              placeholder: 'Optional — defaults to the model ID'
            },
            contextWindow: {
              label: 'Context window',
              placeholder: 'Required — token count'
            },
            maxOutput: {
              label: 'Max output',
              placeholder: 'Required — token count'
            }
          }
        },
        edit: {
          title: 'Edit model',
          description: 'Update the display name, context window, and max output for this model.',
          submit: 'Save changes',
          cancel: 'Cancel'
        },
        delete: {
          title: 'Delete model',
          description:
            "Delete '{{name}}' from the local list? This won't change anything at the provider, and a later sync may bring it back.",
          success: 'Model deleted',
          error: "Couldn't delete model"
        },
        bulk: {
          enableAll: 'Enable all',
          disableAll: 'Disable all'
        },
        meta: {
          contextWindow: '{{value}} ctx',
          maxOutput: '{{value}} out',
          dimensions: '{{value}} dims',
          images: '{{value}} images'
        }
      },
      family: {
        labels: {
          language: 'Text Generation',
          embedding: 'Embeddings',
          image: 'Image Generation',
          transcription: 'Transcription',
          speech: 'Speech'
        },
        unavailable: 'This provider does not expose {{family}} settings.'
      },
      defaults: {
        title: 'Defaults',
        description: 'Save call defaults and provider-specific options for future runtime use.',
        unset: 'Unset',
        callDefaults: {
          label: 'Call defaults JSON',
          description: 'Common call parameters such as temperature or maxOutputTokens.'
        },
        rawProviderOptions: {
          label: 'Raw providerOptions JSON',
          description: 'Advanced escape hatch. Raw values override structured options.'
        },
        reset: {
          button: 'Reset',
          title: 'Reset parameter config',
          description:
            'Reset all parameter defaults for this model family back to system defaults? Saved call defaults and options will be cleared. This cannot be undone.',
          confirm: 'Reset'
        },
        errors: {
          objectRequired: 'JSON value must be an object.'
        }
      }
    },
    settings: {
      page: {
        title: 'Settings',
        tabs: {
          theme: 'Theme',
          permissions: 'Permissions',
          hooks: 'Hooks',
          pet: 'Pet',
          tools: 'Tools'
        }
      },
      tools: {
        intro:
          'Turn built-in tools on or off for the agent. Disabled tools are removed from every agent, including sub-agents.',
        enabledCount: '{{count}}/{{total}}',
        toggleCategory: 'Toggle all tools in this category',
        readOnly: 'read-only',
        categories: {
          files: {
            title: 'Files',
            description: 'Read and edit files in the workspace.'
          },
          search: {
            title: 'Search',
            description: 'Find files and search file contents.'
          },
          shell: {
            title: 'Shell',
            description: 'Run shell commands.'
          },
          browser: {
            title: 'Browser',
            description:
              'Drive the built-in browser: navigate, read, fill forms, click, screenshot.'
          }
        },
        descriptions: {
          fileRead: 'Read a line-numbered window from a file.',
          fileEdit: 'Replace exact text in one file.',
          multiEdit: 'Apply several ordered edits to one file atomically.',
          fileWrite: 'Create or overwrite a file.',
          glob: 'Find files by glob pattern.',
          grep: 'Search file contents with ripgrep.',
          shell: 'Run a shell command.',
          browserOpen: 'Open the built-in browser at a URL.'
        }
      },
      permissions: {
        empty: 'No saved rules yet.',
        emptyDescription: 'Permission decisions saved from approval prompts will appear here.'
      },
      hooks: {
        title: 'Hooks',
        description:
          'Run scripts at agent lifecycle events. Compatible with Codex / Claude Code hooks.json.',
        reload: 'Reload',
        summaryTotal: '{{count}} hook(s)',
        summaryUntrusted: '{{count}} need trust',
        summaryConfig: '.tanzo/hooks.json · ~/.tanzo/hooks.json',
        empty: 'No hooks configured.',
        emptyHint:
          'Add a .tanzo/hooks.json in your project (or ~/.tanzo/hooks.json globally), then Reload.',
        matchAll: '*',
        statusActive: 'Active',
        statusInactive: 'Inactive',
        preview: 'Test',
        previewResult: 'exit {{code}} · {{ms}}ms',
        previewFailed: 'Hook test failed.',
        trustAction: 'Trust',
        trust: {
          managed: 'Managed',
          trusted: 'Trusted',
          modified: 'Modified',
          untrusted: 'Untrusted'
        }
      },
      pet: {
        title: 'Desktop Pet',
        description: 'Show a floating companion that reflects agent activity.',
        enable: 'Enable desktop pet',
        choose: 'Pet',
        chooseDescription: 'Pick which companion appears on your desktop.',
        empty: 'No user or bundled pets found.',
        size: {
          title: 'Size',
          description: 'Scale the pet up or down on your screen.'
        },
        page: 'Page {{page}} of {{pageCount}}'
      },
      language: {
        title: 'Language',
        description: 'Choose the language Tanzo uses across the app.',
        options: {
          en: {
            label: 'English',
            description: 'English labels and messages.'
          },
          zhCN: {
            label: 'Simplified Chinese',
            description: 'Simplified Chinese labels and messages.'
          }
        }
      },
      theme: {
        appearance: {
          title: 'Appearance',
          description: 'Choose theme and display preferences.',
          mode: {
            light: {
              label: 'Light',
              description: 'Best for bright environments.'
            },
            dark: {
              label: 'Dark',
              description: 'Best for low-light environments.'
            },
            system: {
              label: 'System',
              description: 'Match your system appearance.'
            }
          }
        },
        reasoning: {
          title: 'Reasoning Tags',
          description:
            'Control whether thinking and reasoning tags start expanded in chat messages.',
          expand: {
            label: 'Expand reasoning tags by default',
            description: 'Applies to thinking and reasoning XML tags.'
          }
        },
        colors: {
          title: 'Color Theme',
          description: 'Choose the UI accent palette.',
          actions: {
            import: 'Import theme',
            remove: 'Remove'
          },
          import: {
            placeholder: 'Paste a tweakcn theme URL',
            error: 'Import failed',
            errors: {
              invalidUrl: 'The theme URL is not valid.',
              httpsRequired: 'The theme URL must use https.',
              fetchFailed: 'Failed to fetch: {{status}}',
              tooLarge: 'The theme response is too large.',
              invalidJson: 'The theme response was not valid JSON.',
              noVariables: 'No tweakcn theme color variables were found in the response.'
            }
          },
          options: {
            tanzo: {
              label: 'Tanzo',
              description: 'Balanced neutrals with measured depth.'
            },
            vercel: {
              label: 'Vercel',
              description: 'Sharp neutrals with higher contrast.'
            },
            claude: {
              label: 'Claude',
              description: 'Warm neutrals with amber focus.'
            },
            supabase: {
              label: 'Supabase',
              description: 'Cool greens with soft surfaces.'
            },
            twitter: {
              label: 'Twitter',
              description: 'Bright blues with a crisp finish.'
            },
            brutalist: {
              label: 'Brutalist',
              description: 'Bold borders, high contrast, raw edges.'
            }
          }
        },
        wallpaper: {
          title: 'Wallpaper',
          description: 'Set a background image behind the interface.',
          choose: 'Choose image',
          replace: 'Replace',
          clear: 'Remove',
          opacity: 'Opacity',
          blur: 'Blur',
          overlay: {
            title: 'Overlay',
            strength: 'Tint',
            options: {
              none: 'None',
              dark: 'Dark',
              light: 'Light'
            }
          }
        },
        fontSize: {
          title: 'Font Size',
          description: 'Choose the base text size.',
          options: {
            small: {
              label: 'Small',
              description: 'Smaller text for denser layouts.'
            },
            default: {
              label: 'Default',
              description: 'A balanced size for most screens.'
            },
            large: {
              label: 'Large',
              description: 'Larger text for easier reading.'
            }
          }
        }
      }
    },
    mcp: {
      elicitation: {
        title: 'Server input required',
        description: '{{serverName}} is requesting additional input.',
        accept: 'Continue',
        decline: 'Decline',
        noFields: 'This request does not include structured fields.',
        booleanLabel: 'Enabled',
        submitError: "Couldn't submit the MCP response",
        validation: {
          required: '{{field}} is required',
          number: '{{field}} must be a number',
          integer: '{{field}} must be an integer',
          json: '{{field}} must be valid JSON'
        }
      },
      page: {
        title: 'MCP Servers',
        search: {
          placeholder: 'Search MCP servers'
        },
        empty: {
          title: 'No MCP servers',
          description: 'Add a server to expose tools, prompts, and resources.',
          noMatch: {
            title: 'No matching servers',
            description: 'Try a different search.'
          }
        },
        filters: {
          status: {
            label: 'Status'
          },
          transport: {
            label: 'Transport'
          }
        }
      },
      server: {
        create: {
          button: 'Add server',
          title: 'Add MCP Server'
        },
        edit: {
          title: 'Edit MCP Server'
        },
        card: {
          description: {
            command: 'Runs {{command}}',
            url: 'Connects to {{url}}',
            generic: 'Configured MCP server'
          }
        },
        metrics: {
          toolsCount: '{{count}} tools'
        },
        status: {
          connecting: 'Connecting...',
          connectionFailed: 'Connection failed',
          disconnected: 'Disconnected'
        },
        detail: {
          transport: 'Transport',
          server: 'Server',
          createdAt: 'Created',
          commandConfig: 'Command',
          command: 'Command',
          arguments: 'Arguments',
          cwd: 'Working directory',
          fullCommand: 'Full command',
          url: 'URL',
          env: 'Environment',
          tabs: {
            info: 'Info',
            tools: 'Tools',
            prompts: 'Prompts',
            resources: 'Resources'
          },
          tools: {
            empty: 'No tools exposed by this server.',
            schema: 'Params'
          },
          prompts: {
            empty: 'No prompts exposed by this server.',
            arguments: 'Arguments',
            required: 'required',
            optional: 'optional'
          },
          resources: {
            empty: 'No resources exposed by this server.'
          },
          reconnect: 'Reconnect',
          reconnecting: 'Reconnecting...',
          notConnected: 'Server is not connected.',
          notConnectedDescription: 'Connect the server to view its tools, prompts, and resources.'
        },
        form: {
          addServer: 'Add server',
          name: {
            label: 'Server name',
            placeholder: 'My MCP server'
          },
          description: {
            label: 'Description',
            placeholder: 'What is this server for?'
          },
          transport: 'Transport',
          command: 'Command',
          cwd: 'Working directory',
          arguments: {
            label: 'Arguments',
            placeholder: '--flag value',
            help: 'Space-separated arguments.'
          },
          url: {
            label: 'Server URL',
            placeholder: 'https://example.com/mcp'
          },
          headers: {
            label: 'Headers (JSON)',
            placeholder: '{ "Authorization": "Bearer ..." }'
          },
          redirect: {
            label: 'Redirect',
            follow: 'Follow redirects',
            error: 'Error on redirect'
          },
          env: {
            label: 'Environment variables (JSON)',
            placeholder: '{ "API_KEY": "..." }'
          },
          quickStart: 'Quick start',
          template: {
            placeholder: 'Choose a template'
          },
          import: {
            action: 'Import JSON',
            placeholder: 'Paste JSON here'
          },
          errors: {
            invalidJson: 'Enter valid JSON',
            jsonInvalid: '{{field}} must be a valid JSON object.',
            jsonNotObject: '{{field}} must be a JSON object.',
            jsonValuesString: '{{field}} values must all be strings.'
          }
        },
        delete: {
          title: 'Delete server',
          description: 'Delete {{name}} and remove its configuration?'
        },
        templates: {
          filesystem: {
            name: 'File System',
            description: 'Access the local file system.'
          },
          chromeDevtools: {
            name: 'Chrome DevTools',
            description: 'Browser automation through the Chrome DevTools Protocol.'
          },
          everything: {
            name: 'Everything',
            description: 'Reference server with prompts, resources, tools, and completions.'
          }
        },
        notifications: {
          createSuccess: 'Server added',
          createError: "Couldn't add server",
          updateSuccess: 'Server updated',
          updateError: "Couldn't update server",
          deleteSuccess: 'Server deleted',
          deleteError: "Couldn't delete server",
          toggleSuccess: 'Server {{state}}',
          toggleError: "Couldn't update server status",
          reconnectSuccess: 'Server reconnecting',
          reconnectError: "Couldn't reconnect server"
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
        placeholder: 'Send a message…',
        send: 'Send',
        sendShortcut: 'Send · Enter'
      },
      approval: {
        title: 'Permission requested'
      },
      reply: {
        title: 'Tanzo replied',
        open: 'Open'
      }
    },
    plugins: {
      page: {
        title: 'Plugins',
        search: {
          placeholder: 'Search plugins'
        },
        stats: {
          installed: 'installed',
          enabled: 'enabled',
          available: 'available'
        },
        actions: {
          reload: 'Reload'
        },
        sections: {
          installed: 'Installed',
          available: 'Available',
          availableFrom: 'Available · {{name}}'
        },
        empty: {
          title: 'No plugins found',
          description:
            'Tanzo discovers plugins from local marketplaces in ~/.agents/plugins and the active workspace. Add a marketplace.json to install Codex-compatible plugins.'
        }
      },
      status: {
        error: 'error'
      },
      actions: {
        install: 'Install',
        uninstall: 'Uninstall',
        toggle: 'Toggle plugin'
      },
      card: {
        noDescription: 'No description provided.'
      },
      contributes: {
        skills: 'Skills',
        mcp: '{{count}} MCP',
        hooks: 'Hooks'
      },
      detail: {
        version: 'Version',
        category: 'Category',
        path: 'Path',
        contributes: 'Contributions',
        about: 'About',
        keywords: 'Keywords',
        skillsPrefix: 'Skills are prefixed',
        hooksActive: 'Lifecycle hooks active',
        noContributions: 'This plugin contributes no skills, MCP servers, or hooks.',
        mentionHint: 'Mention @{{name}} in chat to focus the model on this plugin for that turn.'
      },
      uninstall: {
        title: 'Uninstall plugin?',
        description:
          'This removes "{{name}}" from the local plugin cache. You can reinstall it from its marketplace later.',
        confirm: 'Uninstall'
      },
      toast: {
        installed: 'Plugin installed',
        uninstalled: 'Plugin uninstalled',
        updateFailed: 'Failed to update plugin',
        installFailed: 'Failed to install plugin',
        uninstallFailed: 'Failed to uninstall plugin',
        reloadFailed: 'Failed to reload plugins'
      },
      marketplace: {
        add: {
          action: 'Add marketplace',
          title: 'Add marketplace',
          source: {
            label: 'Source',
            placeholder: 'owner/repo, a git URL, or a local path',
            hint: 'A GitHub shorthand (owner/repo), git/SSH URL, or local directory containing a marketplace.json.'
          },
          ref: {
            label: 'Ref',
            placeholder: 'branch, tag, or commit'
          },
          sparse: {
            label: 'Sparse paths',
            placeholder: 'comma-separated paths'
          },
          submit: 'Add',
          errors: {
            sourceRequired: 'Enter a marketplace source.',
            addFailed: 'Failed to add marketplace'
          }
        },
        manage: {
          action: 'Marketplaces',
          title: 'Marketplaces',
          type: {
            git: 'Git',
            local: 'Local'
          },
          actions: {
            upgrade: 'Upgrade',
            remove: 'Remove'
          },
          empty: {
            title: 'No marketplaces added',
            description:
              'Add a git or local marketplace to discover plugins beyond the default ~/.agents/plugins and workspace catalogs.'
          }
        },
        toast: {
          added: 'Added marketplace "{{name}}"',
          alreadyAdded: 'Marketplace "{{name}}" is already added',
          removed: 'Removed marketplace "{{name}}"',
          removeFailed: 'Failed to remove marketplace',
          upgraded: 'Upgraded marketplace "{{name}}"',
          upToDate: 'Marketplace "{{name}}" is up to date',
          upgradeFailed: 'Failed to upgrade marketplace'
        }
      }
    },
    skills: {
      page: {
        title: 'Skills',
        search: {
          placeholder: 'Search skills'
        },
        stats: {
          skills: 'skills',
          enabled: 'enabled',
          installed: 'installed'
        },
        actions: {
          install: 'Install',
          reload: 'Reload'
        },
        empty: {
          title: 'No skills found',
          description:
            'Tanzo scans .tanzo/skills and .claude/skills in the active workspace and the user skills directory.'
        }
      },
      filters: {
        scope: { label: 'Scope' },
        status: { label: 'Status' },
        source: { label: 'Source' }
      },
      scope: {
        user: 'User',
        workspace: 'Workspace',
        builtin: 'Built-in',
        plugin: 'Plugin'
      },
      status: {
        enabled: 'enabled',
        disabled: 'disabled'
      },
      source: {
        installed: 'Installed',
        scanned: 'Scanned',
        localInstall: 'Local install'
      },
      card: {
        toggleAria: 'Toggle {{name}}',
        toolCount: '{{count}} tools'
      },
      detail: {
        badges: {
          enabled: 'enabled',
          disabled: 'disabled',
          installed: 'installed'
        },
        uninstall: 'Uninstall',
        sections: {
          details: 'Details'
        },
        fields: {
          name: 'Name',
          source: 'Source',
          model: 'Model',
          license: 'License',
          allowedTools: 'Allowed Tools',
          path: 'Path'
        },
        values: {
          none: 'none',
          allTools: 'all'
        },
        body: {
          title: 'Skill Body',
          empty: 'No body content.'
        }
      },
      install: {
        title: 'Install Skill',
        directory: {
          label: 'Skill directory',
          placeholder: '/path/to/skill',
          choose: 'Choose',
          hint: 'The directory must contain a SKILL.md file with name and description.'
        },
        scope: {
          label: 'Target scope',
          user: 'User',
          workspace: 'Workspace'
        },
        options: {
          label: 'Options',
          enableAfterInstall: 'Enable after install',
          replaceExisting: 'Replace existing target'
        },
        submit: 'Install',
        errors: {
          chooseFirst: 'Choose a local skill directory first.',
          installFailed: 'Install failed',
          chooseDir: 'Could not choose skill directory'
        }
      },
      uninstall: {
        title: 'Uninstall skill?',
        description: 'Installed files and the saved state will be removed.',
        confirm: 'Uninstall',
        cancel: 'Cancel'
      },
      toast: {
        installed: 'Skill installed',
        uninstalled: 'Skill uninstalled',
        updateFailed: 'Failed to update skill',
        uninstallFailed: 'Uninstall failed',
        reloadFailed: 'Reload failed'
      }
    }
  }
} as const
