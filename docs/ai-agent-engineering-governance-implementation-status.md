# AI Agent Engineering Governance 瀹炵幇鐘舵€?

## 最新复核补充（2026-04-25）

- ✅ `erp_module_load` 不再只是预留能力，已接入 `src/composables/useErDiagram.ts` 的 ER 图“显示全部/全量加载”入口，通过 `useJobWorker` 执行并回写进度/结果。
- ✅ `resource_scan` 已补齐 store 提交方法、后台任务面板文案和 `background-job` 单测。
- ✅ 已修复后台任务面板与 `AiChatView` 的类型接线问题，避免任务列表渲染时出现创建时间类型和 `.value` 解包错误。
- ✅ 针对性测试通过：`background-job.test.ts`、`useJobWorker.test.ts`、`streamBackpressure.test.ts`、`useErDiagram.test.ts`。
- ⚠️ 全量 `pnpm test:typecheck` 仍被其它历史 AI 类型债阻塞，本轮第二阶段相关新增错误已处理。鏇存柊鏃堕棿锛?026-04-25

## 鏈疆琛ラ綈

- Background Job 鎭㈠闂幆锛歚useJobWorker.recoverInterruptedJobs()` 浼氫粠鍚庣鎭㈠ job 鐘舵€侊紝骞舵妸鍒锋柊鍚庢棤娉曠户缁墽琛岀殑 active job 鏍囪涓?interrupted锛岄伩鍏?UI 姘镐箙鏄剧ず running銆?- Background Job 鍙栨秷闂幆锛歚jobWorker.cancel()` 鍚屾 abort 鍓嶇鎵ц鍣ㄥ苟鏇存柊鍚庣 job 鐘舵€侊紱鍚庡彴浠诲姟闈㈡澘鏂板 active job 鍙栨秷鍏ュ彛銆?- ERP 妯″潡鍔犺浇 job 鑳藉姏锛歚background-job` store 鏂板 `submitErpModuleLoadJob()`锛屽苟琛ラ綈 `erp_module_load` 闈㈡澘鏂囨锛屼緵 ERP 鍔熻兘鏍?妯″潡鍔犺浇椤甸潰鎺ュ叆銆?- Stream Backpressure 鏄庣‘鍖栵細鏂板 `streamBackpressure.ts`锛屾妸 50ms flush 涓庢渶澶х紦鍐插瓧绗︽暟浠庨殣寮忓父閲忓彉鎴愬彲娴嬭瘯绛栫暐銆?
## 宸查獙璇?
- `pnpm vitest run src/stores/__tests__/background-job.test.ts src/composables/__tests__/useJobWorker.test.ts src/composables/__tests__/streamBackpressure.test.ts src/components/ai/AiChatShell.test.ts src/views/__tests__/AiChatView.interaction.test.ts`
- `pnpm type-check`
- `cd src-tauri && cargo check`

## 浠嶉渶椤甸潰绾ф帴绾?
- 褰撳墠浠ｇ爜搴撴湭瀹氫綅鍒版槑纭懡鍚嶇殑 ERP 鍔熻兘鏍戦〉闈?缁勪欢锛涙湰杞凡鎻愪緵 `erp_module_load` job 鑳藉姏涓?UI 灞曠ず锛屽悗缁彧闇€瑕佸湪瀹為檯 ERP 鍔犺浇鍏ュ彛璋冪敤 `submitErpModuleLoadJob()`锛屽苟鍦ㄥ姞杞藉畬鎴愬悗鐢?`succeedJob/failJob` 鍐欏洖缁撴灉銆?- 濡傛灉 ERP 鍔熻兘鏍戝疄闄呭湪鏁版嵁搴撳璞℃爲鎴栧叾瀹冧笟鍔℃ā鍧椾腑锛岄渶瑕佹寜鍏蜂綋缁勪欢鍐嶅仛涓€娆℃帴绾匡紝閬垮厤璇敼闈?ERP 閫昏緫銆?
