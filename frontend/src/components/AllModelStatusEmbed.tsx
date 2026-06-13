import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  Loader2,
  Search,
  Timer,
  X,
  XCircle,
} from 'lucide-react'
import { cn } from '../lib/utils'

interface SlotStatus {
  slot: number
  start_time: number
  end_time: number
  total_requests: number
  success_count: number
  success_rate: number
  status: 'green' | 'yellow' | 'red'
}

interface ModelStatus {
  model_name: string
  display_name: string
  time_window: string
  total_requests: number
  success_count: number
  success_rate: number
  current_status: 'green' | 'yellow' | 'red'
  slot_data: SlotStatus[]
}

interface ModelGroup {
  group_name: string
  models: Array<{
    model_name: string
    channel_count: number
    request_count_24h: number
  }>
  model_count: number
  active_model_count: number
  channel_count: number
  request_count_24h: number
}

interface AllModelStatusEmbedProps {
  refreshInterval?: number
}

const TIME_WINDOWS = [
  { value: '1h', label: '1小时' },
  { value: '6h', label: '6小时' },
  { value: '12h', label: '12小时' },
  { value: '24h', label: '24小时' },
]

const ALL_GROUP = '__all__'

function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN')
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status: ModelStatus['current_status']) {
  if (status === 'green') return '正常'
  if (status === 'yellow') return '波动'
  return '异常'
}

function statusIcon(status: ModelStatus['current_status']) {
  if (status === 'green') return CheckCircle2
  if (status === 'yellow') return AlertCircle
  return XCircle
}

function statusClass(status: ModelStatus['current_status']) {
  if (status === 'green') return 'text-emerald-600 bg-emerald-50 border-emerald-200'
  if (status === 'yellow') return 'text-amber-600 bg-amber-50 border-amber-200'
  return 'text-rose-600 bg-rose-50 border-rose-200'
}

function slotClass(slot: SlotStatus) {
  if (slot.total_requests === 0) return 'bg-slate-200'
  if (slot.status === 'green') return 'bg-emerald-500'
  if (slot.status === 'yellow') return 'bg-amber-400'
  return 'bg-rose-500'
}

function getAggregateStatus(models: ModelStatus[]): ModelStatus['current_status'] {
  const total = models.reduce((sum, model) => sum + model.total_requests, 0)
  const success = models.reduce((sum, model) => sum + model.success_count, 0)
  if (total === 0) return 'green'
  const rate = (success / total) * 100
  if (rate >= 95) return 'green'
  if (rate >= 80) return 'yellow'
  return 'red'
}

function getAggregateRate(models: ModelStatus[]): number {
  const total = models.reduce((sum, model) => sum + model.total_requests, 0)
  const success = models.reduce((sum, model) => sum + model.success_count, 0)
  if (total === 0) return 100
  return Math.round((success / total) * 10000) / 100
}

export function AllModelStatusEmbed({ refreshInterval: defaultRefreshInterval = 60 }: AllModelStatusEmbedProps) {
  const [groups, setGroups] = useState<ModelGroup[]>([])
  const [models, setModels] = useState<ModelStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeGroup, setActiveGroup] = useState(ALL_GROUP)
  const [timeWindow, setTimeWindow] = useState('24h')
  const [refreshInterval, setRefreshInterval] = useState(defaultRefreshInterval)
  const [countdown, setCountdown] = useState(defaultRefreshInterval)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [query, setQuery] = useState('')

  const apiUrl = import.meta.env.VITE_API_URL || ''

  const modelMap = useMemo(() => {
    const map = new Map<string, ModelStatus>()
    for (const model of models) {
      map.set(model.model_name, model)
    }
    return map
  }, [models])

  const allModelNames = useMemo(() => models.map(model => model.model_name), [models])

  const activeGroupInfo = useMemo(() => {
    if (activeGroup === ALL_GROUP) return null
    return groups.find(group => group.group_name === activeGroup) || null
  }, [activeGroup, groups])

  const activeModels = useMemo(() => {
    const names = activeGroupInfo
      ? activeGroupInfo.models.map(model => model.model_name)
      : allModelNames
    const q = query.trim().toLowerCase()

    return names
      .map(name => modelMap.get(name))
      .filter((model): model is ModelStatus => Boolean(model))
      .filter(model => !q || model.model_name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (b.total_requests !== a.total_requests) return b.total_requests - a.total_requests
        return a.model_name.localeCompare(b.model_name)
      })
  }, [activeGroupInfo, allModelNames, modelMap, query])

  const aggregateStatus = getAggregateStatus(activeModels)
  const aggregateRate = getAggregateRate(activeModels)
  const totalRequests = activeModels.reduce((sum, model) => sum + model.total_requests, 0)

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/model-status/embed/config/selected`)
      const data = await response.json()
      if (data.success) {
        if (data.time_window) setTimeWindow(data.time_window)
        if (data.refresh_interval !== undefined && data.refresh_interval !== null) {
          setRefreshInterval(data.refresh_interval)
          setCountdown(data.refresh_interval)
        }
      }
    } catch (err) {
      console.error('Failed to load embed config:', err)
    }
  }, [apiUrl])

  const fetchData = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const [groupsResponse, statusResponse] = await Promise.all([
        fetch(`${apiUrl}/api/model-status/embed/groups`),
        fetch(`${apiUrl}/api/model-status/embed/status/all?window=${timeWindow}`),
      ])
      const [groupsData, statusData] = await Promise.all([
        groupsResponse.json(),
        statusResponse.json(),
      ])

      if (!groupsData.success) throw new Error(groupsData.error?.message || '分组加载失败')
      if (!statusData.success) throw new Error(statusData.error?.message || '状态加载失败')

      setGroups(groupsData.data || [])
      setModels(statusData.data || [])
      setLastUpdate(new Date())
    } catch (err) {
      console.error('Failed to load all model statuses:', err)
      setError(err instanceof Error ? err.message : '状态数据加载失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [apiUrl, timeWindow])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    fetchData(false)
  }, [fetchData])

  useEffect(() => {
    if (refreshInterval <= 0) return

    let lastRefresh = Date.now()
    const timer = window.setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          fetchData(true)
          lastRefresh = Date.now()
          return refreshInterval
        }
        return prev - 1
      })
    }, 1000)

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const elapsed = Math.floor((Date.now() - lastRefresh) / 1000)
      if (elapsed >= refreshInterval) {
        fetchData(true)
        lastRefresh = Date.now()
        setCountdown(refreshInterval)
      } else {
        setCountdown(Math.max(1, refreshInterval - elapsed))
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchData, refreshInterval])

  useEffect(() => {
    setCountdown(refreshInterval)
  }, [refreshInterval])

  const handleTimeWindowChange = (value: string) => {
    setTimeWindow(value)
    setCountdown(refreshInterval)
  }

  if (loading && models.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">加载模型状态...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-600" />
                <h1 className="text-xl font-semibold tracking-tight text-slate-950">模型状态监控</h1>
                <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", statusClass(aggregateStatus))}>
                  {statusLabel(aggregateStatus)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>{activeGroupInfo ? activeGroupInfo.group_name : '全部分组'}</span>
                <span>{activeModels.length} 个模型</span>
                <span>{formatNumber(totalRequests)} 次请求</span>
                <span>成功率 {aggregateRate}%</span>
                {lastUpdate && <span>更新于 {lastUpdate.toLocaleTimeString('zh-CN')}</span>}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-1">
                {TIME_WINDOWS.map(window => (
                  <button
                    key={window.value}
                    type="button"
                    onClick={() => handleTimeWindowChange(window.value)}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition",
                      timeWindow === window.value
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    {window.label}
                  </button>
                ))}
              </div>
              {refreshInterval > 0 && (
                <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500">
                  <Timer className="h-3.5 w-3.5" />
                  <span className="font-mono text-slate-700">{formatCountdown(countdown)}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => fetchData(true)}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                disabled={refreshing}
              >
                {refreshing ? '刷新中' : '刷新'}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="flex flex-1 flex-wrap gap-2">
              <GroupTab
                active={activeGroup === ALL_GROUP}
                name="全部"
                modelCount={models.length}
                requestCount={models.reduce((sum, model) => sum + model.total_requests, 0)}
                onClick={() => setActiveGroup(ALL_GROUP)}
              />
              {groups.map(group => (
                <GroupTab
                  key={group.group_name}
                  active={activeGroup === group.group_name}
                  name={group.group_name}
                  modelCount={group.model_count}
                  requestCount={group.request_count_24h}
                  onClick={() => setActiveGroup(group.group_name)}
                />
              ))}
            </div>

            <div className="relative w-full lg:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="搜索模型"
                className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="清空搜索"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5">
        {error && (
          <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {activeModels.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {activeModels.map(model => (
              <ModelStatusRow key={model.model_name} model={model} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
            没有匹配的模型状态数据
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-5 text-xs text-slate-500">
          <LegendDot className="bg-emerald-500" label="成功率 >= 95%" />
          <LegendDot className="bg-amber-400" label="成功率 80-95%" />
          <LegendDot className="bg-rose-500" label="成功率 < 80%" />
          <LegendDot className="bg-slate-200" label="无请求" />
        </div>
      </main>
    </div>
  )
}

interface GroupTabProps {
  active: boolean
  name: string
  modelCount: number
  requestCount: number
  onClick: () => void
}

function GroupTab({ active, name, modelCount, requestCount, onClick }: GroupTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-2 text-left transition",
        active
          ? "border-blue-300 bg-blue-50 text-blue-700 shadow-sm"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      )}
    >
      <span className="block max-w-[180px] truncate text-sm font-medium">{name}</span>
      <span className="mt-0.5 block text-[11px] opacity-75">
        {modelCount} 模型 · {formatNumber(requestCount)}
      </span>
    </button>
  )
}

function ModelStatusRow({ model }: { model: ModelStatus }) {
  const StatusIcon = statusIcon(model.current_status)

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md border", statusClass(model.current_status))}>
              <StatusIcon className="h-4 w-4" />
            </span>
            <h2 className="truncate text-sm font-semibold text-slate-950" title={model.model_name}>
              {model.model_name}
            </h2>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>{statusLabel(model.current_status)}</span>
            <span>成功率 {model.success_rate}%</span>
            <span>{formatNumber(model.total_requests)} 次请求</span>
          </div>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", statusClass(model.current_status))}>
          {model.success_rate}%
        </span>
      </div>

      <div className="mt-4">
        <div className="flex h-7 gap-0.5">
          {model.slot_data.map(slot => (
            <div
              key={slot.slot}
              className={cn("group relative min-w-0 flex-1 rounded-sm transition hover:-translate-y-0.5", slotClass(slot))}
              title={`${formatTime(slot.start_time)} - ${formatTime(slot.end_time)} | ${slot.total_requests} 请求 | ${slot.success_rate}%`}
            >
              <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-44 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-lg group-hover:block">
                <div className="font-medium text-slate-900">
                  {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                </div>
                <div className="mt-1 flex justify-between">
                  <span>请求</span>
                  <span>{formatNumber(slot.total_requests)}</span>
                </div>
                <div className="flex justify-between">
                  <span>成功</span>
                  <span>{formatNumber(slot.success_count)}</span>
                </div>
                <div className="flex justify-between">
                  <span>成功率</span>
                  <span>{slot.success_rate}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {model.time_window === '1h' ? '60分钟前' : `${model.time_window}前`}
          </span>
          <span>现在</span>
        </div>
      </div>
    </section>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-3 w-3 rounded-sm", className)} />
      <span>{label}</span>
    </div>
  )
}
