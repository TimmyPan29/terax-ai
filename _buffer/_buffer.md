核心考量與架構邏輯
該配置的核心目標是在「最少 Token 成本 (USD)」與「最高程式碼品質/穩定性」之間取得最佳平衡（即極致的性價比）。其核心策略為：
高階決策與審查（不省錢）：規劃、架構、任務拆解與審查（Planning & Reviewing）屬於關鍵路徑，出錯會導致整體重來（燒更多 Token）。因此強制使用推理能力最強、最穩定的 GPT-5.5 進行把關。
程式碼執行與長文本讀取（極致省錢）：實際編程與大量檔案讀取（Execution & Reading）消耗最大量的 Token。因此採用 DeepSeek V4 Pro（成本極低、編程能力強）與 Gemini-3.1-Pro（長上下文、原生多模態且便宜）來承接。
透過此配置，在中等功能的開發上，預期能比全量使用 GPT-5.5 節省約 70% 的費用，且不犧牲品質。
角色配置與模型分工
1. Primary 主控層 (High-level 決策與調度)
角色名稱	核心職責	建議模型	採用原因
sisyphus (主代理)	總控、承接用戶意圖、處理長對話與多檔案重構。	DeepSeek V4 Pro	成本極低，1M 上下文適合長對話，運算資源消耗（FLOPs）僅需 V3 的 27%。
hephaestus (工程化)	負責 Tool calling、MCP、Git 操作、LSP 檢查與 Pipeline 執行。	GPT-5.4+	指令遵循與 Function calling 最穩定，能避免輸出格式錯誤導致流程中斷。
prometheus (規劃師)	深度訪談並撰寫全局開發計劃。	
GPT-5.5

(備援: Gemini-3.1-Pro)
需要強推理與長思考能力。GPT-5.5 最精準；Gemini 便宜但規劃深度略輸。
oracle (架構顧問)	架構決策與設計。	GPT-5.5	需要 0 幻覺與最高穩定性。
atlas (指揮官)	讀取計劃、拆解任務、驗收成果（不直接寫碼）。	
GPT-5.5

(預算緊: DeepSeek V4 Pro)
需要精準理解與驗證能力。GPT-5.5 最穩；DS V4 Pro 編程體驗佳但交付略輸。
2. Subagent 工作層 (低成本執行與特化任務)
角色名稱	核心職責	建議模型	採用原因
librarian (文件/OSS查詢)	檢索與總結外部技術文件、開源套件。	Gemini-3.1-Pro	檢索與總結能力強，1M 上下文且價格便宜。
explore (代碼庫 grep)	掃描整個 Repository 尋找特定的代碼 Pattern。	
DeepSeek V4 Pro

(或 Gemini-3.1-Pro)
唯讀任務且吃大量輸入 Token，適合大上下文且便宜的模型。
multimodal-looker (多模態)	查看圖片、UI 截圖驗證。	Gemini-3.1-Pro	原生多模態能力最穩定且划算（OpenAI 方案太貴，DeepSeek 尚不成熟）。
metis (計劃顧問)	挑出 Prometheus 計劃中的邏輯漏洞。	GPT-5.5	屬於推理能力天花板，用於嚴格審查。
momus (計劃審查)	100% 驗證檔案引用，確保 ≥90% 的任務具備驗收標準。	GPT-5.5	必須一次過關，若在此處發生錯誤會導致「REJECT 循環」引發 Token 暴漲。
sisyphus-junior (執行工)	主力寫碼者，吞吐最高量 Token 的角色。	
DeepSeek V4 Pro

(兜底: GPT-5.5)
DS V4 Pro 編程基準分高（8.48）且成本極低。若遇 Function calling 不穩或失敗，再由 GPT-5.5 介入重寫。
核心省錢策略三劍客
混合編排 (Planning vs. Execution)
規劃層（Prometheus/Metis/Momus/Atlas）：用最高階的 GPT-5.5。因為「方向錯了，後面全錯」，高階決策必須一步到位。
執行層（Junior）：用 DeepSeek V4 Pro。代碼出錯可以透過測試引導重試（Retry），而 DS 的 Token 價格便宜 10 倍以上，容錯成本低。
海量輸入走「低單價長文本」通路
Explore 與 Librarian 涉及大量的代碼庫掃描與文件讀取，屬於典型的高 Token 輸入、唯讀任務。全部交由 Gemini-3.1-Pro 與 DeepSeek V4 Pro 承接，極大化壓低 Input Cost。
快路徑分流 (Quick Task Bypass)
當任務分類（Category）被判定為 quick（例如：簡單修改、添加 Log、修復 Typo）時，不啟動複雜的 Agent 鏈路，強制直接交由 DeepSeek V4 Pro 快速處理，節省調度成本
。
我該怎麼混用 terax-ai可以做到這點嗎
要完全實作你上面提到的這套「OmO 多代理架構」與「動態模型路由（Routing）」策略，我們需要先釐清你提到的工具：
目前市場上並無知名開源或主流的 Agent 框架名為 terax-ai。這極有可能是某個特定團隊的內部工具、開源新專案，或是你所使用的系統簡稱。不過，不論底層框架是自研、特化版，還是常見的 LlamaIndex Workflows、LangGraph、AutoGen，要做到這種「混合模型調度」在架構上是絕對可行的。
以下為你整理如何混用這些模型，以及在架構上要做到這一點的具體實作方法與關鍵組件：
實作此架構的 3 大核心技術組件
要做到「規劃用 GPT-5.5、執行用 DeepSeek、讀檔用 Gemini」，你的 Agent 框架必須具備或實作以下三個核心能力：
1. 統一的 LLM 抽象層 (LLM Provider Interface)
你的框架必須支援同時串接多個 API 來源（OpenAI, Google Vertex AI/AI Studio, DeepSeek），並能為每個 Agent 綁定獨立的 model_id 與實例（Instance）。
hephaestus (工程化) 與 sisyphus-junior (執行工)：需要傳入完整的 Tool/Function schema，因此 LLM 抽象層必須支援原生 Function Calling（GPT-5.4+ 與 DeepSeek V4 Pro 均具備）。
2. 動態路由與狀態機 (State Management & Routing)
不能所有任務都走同一條鏈路。你需要一個主控節點（通常是 sisyphus 或 atlas 程式碼邏輯）來根據任務狀態切換模型：
分類分流 (task(category="quick"))：在進入工作流前，先用一個超輕量的規則（或輕量模型）判斷類別。若是 quick，直接跳過 Prometheus 規劃節點，狀態機直接將任務 Payload 投遞給 sisyphus-junior (DeepSeek)。
降級與兜底機制 (Fallback)：當 sisyphus-junior (DeepSeek) 輸出格式錯誤（例如 JSON 損壞）或 Tool calling 失敗達到 2 次時，狀態機必須能觸發異常補救，將同一個 Task 切換給 GPT-5.5 重新執行。
3. 多模態與上下文傳遞 (Context Management)
Explore (代碼庫grep) 讀取了 500KB 的 Repo 內容後，這些 Context 在傳遞給 sisyphus-junior 寫碼時，必須進行適當的上下文壓縮或剪枝（或利用 DeepSeek 的快取機制 Prompt Caching），否則跨模型傳遞大量 Token 仍會造成浪費。
當觸發前端/UI 驗收時，工作流將狀態引導至 multimodal-looker，此時傳入的 Payload 必須包含圖片（Base64 或 Image URL），並指派給 Gemini-3.1-Pro。
如果你要在框架中手動實作（偽代碼邏輯）
如果你的框架（如你提到的系統）支援自定義節點，你可以參考以下虛擬邏輯來配置你的多代理路由：
Python
from terax_ai import Agent, Workflow, Task # 假設的框架語法

# 1. 定義各個特化 Agent 及其專屬模型
prometheus = Agent(name="Prometheus", model="gpt-5.5", system_prompt="你負責深度訪談與撰寫計畫...")
momus = Agent(name="Momus", model="gpt-5.5", system_prompt="你負責嚴格審查計畫，確保有驗收標準...")
explore = Agent(name="Explore", model="deepseek-v4-pro", system_prompt="你負責在Repo中搜尋Pattern...")
junior = Agent(name="Junior", model="deepseek-v4-pro", system_prompt="你負責根據計畫編寫代碼...")
fallback_junior = Agent(name="JuniorFallback", model="gpt-5.5", system_prompt="你負責修正失敗的代碼...")

# 2. 構建動態工作流
wf = Workflow()

@wf.node
def route_task(task):
    if task.category == "quick":
        return "execute_quick_path"
    return "planning_path"

@wf.node
def planning_path(task):
    plan = prometheus.run(task)
    review = momus.run(plan)
    if review.status == "REJECT":
        # 為了避免燒 token，這裡可以有次數限制，或轉交人工
        return "planning_path" 
    return "execution_path"

@wf.node
def execution_path(task, plan):
    # 先用 explore 讀取代碼庫（便宜）
    repo_context = explore.run(task.repo)
    try:
        # 主力執行用 DeepSeek (省錢)
        result = junior.run(plan, repo_context)
        return result
    except FunctionCallingError:
        # DeepSeek 失敗時，自動用 GPT-5.5 兜底
        return fallback_junior.run(plan, repo_context)
總結：怎麼檢驗你的工具能否做到？
請檢查你手邊的 AI 工具或框架是否具備以下三點：
是否能自由更換 API Key 與 Base URL（這樣才能同時塞入 OpenAI、Google 和 DeepSeek 的金鑰）。
是否支援動態條件分支（Conditional Routing），而不是只能走固定 A → B → C 的直線 Pipeline。
是否支援獨立為單一節點配置 System Prompt 與 Model。
如果這三點都具備，你就能完美複製這套「極致性價比」的 OmO 混合代理配置！
omo混合代理是github什麼專案
你提到的這套 OmO 多代理架構，其背後的 GitHub 開源專案全名叫做：
👉 code-yeongyu/oh-my-openagent (在社群與命令列中常被簡稱為 omo 或 oh-my-opencode)。
同時，因為它在終端機（CLI）編程圈非常熱門，也有開發者將這套架構移植到了 Claude Code 生態，對應的插件專案為 mrzhbr/oh_my_openclaude。
這個專案是在做什麼的？
簡單來說，它是一個為 OpenCode（或 Claude Code）等終端機 AI 編碼助手設計的高階多代理協調系統（Multi-Agent Orchestration）。
原生的 AI 編碼助手通常是「單一 Agent」在運作——你給它一個任務，它就自己一邊讀檔、一邊思考、一邊改程式碼。但在面對大型專案或複雜重構時，單一 Agent 很容易「顧此失失彼」或陷入邏輯死胡同。
OmO 的解決方案就是把你貼文裡提到的古希臘神話角色（Sisyphus, Prometheus, Hephaestus, Atlas 等）具現化成一整個特化專家團隊：
規劃階段 (/plan 或 /ultrawork)：
先由 Prometheus（規劃師） 出面找你進行深度訪談，釐清你的真實需求。
Oracle（架構顧問） 與 Librarian（文件官） 在旁提供架構盲點與外部 API 文件支援。
產出計畫後，交給 Metis（邏輯挑惕者） 和 Momus（嚴格審查官） 瘋狂找漏洞。如果計畫不夠完美，直接 REJECT 退回重寫，確保「計畫動工前就是對的」。
執行與驗收階段 (Ralph-Loop)：
計畫通過後，交給 Atlas（指揮官） 拆解成 TODO 任務清單。
真正苦力的髒活（寫代碼、讀 Repo）再發包給 Sisyphus-junior（打 code 執行工） 和 Explore（代碼庫搜尋） 去瘋狂消耗 Token。
寫完後，再透過 Hephaestus 跑自動化測試與 LSP 檢查，甚至用 Multimodal-looker 看截圖來確保品質。
回到你最初的問題：「怎麼用你的 terax-ai 做到這點？」
既然你知道了它的真實身分是 oh-my-openagent，它的核心靈魂就是那套 .md 檔案定義的 Agent 行為指南與狀態機調度邏輯。
如果你手邊的 terax-ai 是一個支援多 Agent 串接的框架（類似 LangGraph、AutoGen 或 團隊內部封裝的 Workflow 工具），你完全可以借鑑 OmO 的設計：
第一步：在你的 terax-ai 中，依樣畫葫蘆建立這 10 個不同的 Agent 節點，並把 OmO 專案在 GitHub 上的 System Prompt 邏輯餵給它們。
第二步：也是最精髓的部分，設定動態路由（Routing）。在規劃節點綁定 GPT-5.5 的 API Key，在執行與讀檔節點（Junior/Explore）綁定 DeepSeek / Gemini 的 API Key。
這樣一來，你不需要換掉你現有的 terax-ai 底層，也能完美實現這套「最強大腦規劃、最平價勞工寫碼」的 70% 激省 Token 策略了！
