/**
 * AI Provider Gateway 统一入口
 *
 * 封装所有 AI 请求，提供 requestId、追踪和 usage 记录。
 * 内部调用现有的 `aiChatStream`，保持向后兼容。
 */

import { aiChatStream, aiAbortStream } from '@/api/ai'
import type { ModelConfig } from '@/types/ai'
import { createLogger } from '@/utils/logger'
import type {
  AiGatewayRequest,
  AiGatewayResult,
  AiGatewayContext,
  AiGatewayUsage,
  AiGatewayCost,
  AiGatewayEventHandler,
} from './types'
import { AiGatewayError } from './types'
import { recordUsage } from './usageTracker'
import { consumeQuota } from './rateLimiter'
import { recordProviderSuccess, recordProviderFailure, nextFallbackCandidate } from './router'
import { estimateRequestTokens, type TokenEstimateResult } from './tokenEstimator'
import { checkEndpointSecurity, getDefaultSecurityConfig } from './security'
import { applyGatewayOverrides, hasActiveOverrides } from './override'

const log = createLogger('ai.gateway')

function startSpan(name: string, parentId?: string, attributes?: Record<string, unknown>): string {
  const spanId = `gateway-span-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  log.debug('span_start', { spanId, name, parentId, ...attributes })
  return spanId
}

function endSpan(spanId: string, status: string, attributes?: Record<string, unknown>): void {
  log.debug('span_end', { spanId, status, ...attributes })
}

/** 生成 requestId */
function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 将原始错误分类为 GatewayError */
function classifyError(err: unknown): AiGatewayError {
  // 提取 message：优先从对象属性读取，再尝试 Error.message，最后 String()
  let message: string
  let retryable: boolean | undefined

  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>
    if (typeof obj.message === 'string') {
      message = obj.message
    } else if (err instanceof Error) {
      message = err.message
    } else {
      message = String(err)
    }
    if (typeof obj.retryable === 'boolean') {
      retryable = obj.retryable
    }
  } else if (err instanceof Error) {
    message = err.message
  } else {
    message = String(err)
  }

  if (retryable !== undefined) {
    // 结构化错误对象：保留 retryable，类型兜底为 unknown
    return new AiGatewayError('unknown', message, retryable, err)
  }

  if (/cancel|abort|user_rejected/i.test(message)) {
    return new AiGatewayError('cancelled', message, false, err)
  }
  if (/timeout|timed out/i.test(message)) {
    return new AiGatewayError('timeout', message, true, err)
  }
  if (/rate.limit|429/i.test(message)) {
    return new AiGatewayError('rate_limit', message, true, err)
  }
  if (/auth|key|unauthorized|401/i.test(message)) {
    return new AiGatewayError('auth', message, false, err)
  }
  if (/context.too.long|too.many.tokens|413/i.test(message)) {
    return new AiGatewayError('context_too_long', message, false, err)
  }
  if (/network|connection|fetch failed|5\d{2}/i.test(message)) {
    return new AiGatewayError('network', message, true, err)
  }
  return new AiGatewayError('unknown', message, true, err)
}

/** 计算成本 */
function computeCost(usage: AiGatewayUsage, model: ModelConfig): AiGatewayCost | undefined {
  const pricing = model.capabilities.pricing
  if (!pricing) return undefined

  const inputCost = (usage.promptTokens / 1_000_000) * pricing.inputPer1m
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPer1m
  const cacheReadCost = usage.cacheReadTokens
    ? (usage.cacheReadTokens / 1_000_000) * (pricing.inputPer1m * 0.5)
    : 0

  return {
    inputCost,
    outputCost,
    cacheReadCost,
    totalCost: inputCost + outputCost + cacheReadCost,
    currency: pricing.currency,
  }
}

/** 构建 GatewayContext */
function buildContext(
  request: AiGatewayRequest,
  requestId: string,
): AiGatewayContext {
  return {
    requestId,
    sessionId: request.sessionId,
    source: request.source,
    kind: request.kind,
    providerProfileId: request.provider.id,
    providerType: request.provider.providerType,
    model: request.model.id,
    upstreamModel: request.model.id,
    stream: request.stream ?? true,
    retryIndex: 0,
    startedAt: Date.now(),
  }
}

function applyRequestOverrides(request: AiGatewayRequest, requestId: string): AiGatewayRequest {
  if (!hasActiveOverrides()) return request

  const overrideResult = applyGatewayOverrides(request)
  if (overrideResult.applied.length === 0) return request

  log.info('gateway_override_applied', {
    requestId,
    fields: overrideResult.applied,
  })

  return {
    ...request,
    ...overrideResult.overridden,
  }
}

function assertEndpointAllowed(request: AiGatewayRequest, requestId: string): void {
  const securityResult = checkEndpointSecurity(request.provider.endpoint, {
    ...getDefaultSecurityConfig(),
    ...request.provider.security,
  })
  if (!securityResult.allowed) {
    log.warn('gateway_endpoint_security_blocked', {
      requestId,
      endpoint: request.provider.endpoint,
      providerId: request.provider.id,
      reason: securityResult.reason,
    })
    throw new AiGatewayError(
      'provider_error',
      `Endpoint security check failed: ${securityResult.reason}`,
      false,
    )
  }
}

function estimateAndAssertTokenBudget(request: AiGatewayRequest, requestId: string): TokenEstimateResult {
  const tokenEstimate = estimateRequestTokens({
    messages: request.messages,
    systemPrompt: request.systemPrompt,
    enableTools: request.enableTools,
    model: request.model,
    targetMaxTokens: request.maxTokens,
  })

  if (!tokenEstimate.withinBudget) {
    log.warn('gateway_token_budget_exceeded', {
      requestId,
      estimatedTotal: tokenEstimate.estimatedTotalTokens,
      maxContext: request.model.capabilities.maxContext,
      model: request.model.id,
      providerId: request.provider.id,
    })
    throw new AiGatewayError(
      'context_too_long',
      `Estimated tokens (${tokenEstimate.estimatedTotalTokens}) exceed model context limit (${request.model.capabilities.maxContext}). Consider compacting history or switching to a model with larger context.`,
      false,
    )
  }

  return tokenEstimate
}

function preflightGatewayRequest(request: AiGatewayRequest, requestId: string): TokenEstimateResult {
  assertEndpointAllowed(request, requestId)
  return estimateAndAssertTokenBudget(request, requestId)
}

function recordGatewayError(params: {
  request: AiGatewayRequest
  requestId: string
  startedAt: number
  error: AiGatewayError
  context?: AiGatewayContext
}): void {
  const finishedAt = Date.now()
  params.context && (params.context.finishedAt = finishedAt)
  recordUsage({
    requestId: params.requestId,
    sessionId: params.request.sessionId,
    source: params.request.source,
    kind: params.request.kind,
    providerProfileId: params.context?.providerProfileId ?? params.request.provider.id,
    providerId: params.request.provider.id,
    model: params.request.model.id,
    primaryProviderId: params.context?.primaryProviderId,
    primaryModel: params.context?.primaryModel,
    fallbackReason: params.context?.fallbackReason,
    fallbackChainId: params.context?.fallbackChainId,
    retryIndex: params.context?.retryIndex,
    startedAt: params.startedAt,
    finishedAt,
    status: params.error.type === 'cancelled' ? 'cancelled' : 'error',
    error: params.error,
  })
}

/**
 * 执行单条流式请求（内部使用）
 */
async function executeSingleRequest(
  request: AiGatewayRequest,
  onEvent: AiGatewayEventHandler,
  context: AiGatewayContext,
): Promise<AiGatewayResult> {
  const startedAt = Date.now()
  const spanId = startSpan('gateway_request', undefined, {
    requestId: context.requestId,
    source: request.source,
    kind: request.kind,
    provider: request.provider.id,
    model: request.model.id,
    retryIndex: context.retryIndex,
  })

  log.info('gateway_request_start', {
    requestId: context.requestId,
    sessionId: request.sessionId,
    source: request.source,
    kind: request.kind,
    provider: request.provider.id,
    model: request.model.id,
    retryIndex: context.retryIndex,
  })

  let content = ''
  let finishReason = ''
  let usage: AiGatewayUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  let firstTokenReceived = false

  const wrappedHandler: AiGatewayEventHandler = (event) => {
    switch (event.type) {
      case 'TextDelta':
        content += event.delta
        break
      case 'ThinkingDelta':
        break
      case 'Usage':
        usage = {
          promptTokens: event.prompt_tokens,
          completionTokens: event.completion_tokens,
          totalTokens: event.prompt_tokens + event.completion_tokens,
          cacheReadTokens: event.cache_read_tokens,
        }
        break
      case 'Done':
        finishReason = event.finish_reason
        break
    }

    if (!firstTokenReceived && (event.type === 'TextDelta' || event.type === 'ThinkingDelta')) {
      firstTokenReceived = true
      context.firstTokenAt = Date.now()
      log.info('gateway_first_token', { requestId: context.requestId, ttfbMs: context.firstTokenAt - startedAt })
    }

    onEvent(event)
  }

  try {
    const result = await aiChatStream(
      {
        sessionId: request.sessionId,
        messages: request.messages,
        providerType: request.provider.providerType,
        model: request.model.id,
        apiKey: request.apiKey,
        endpoint: request.provider.endpoint,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        systemPrompt: request.systemPrompt,
        enableTools: request.enableTools,
        thinkingBudget: request.thinkingBudget,
        responseFormat: request.responseFormat,
        prefixCompletion: request.prefixCompletion,
        prefixContent: request.prefixContent,
      },
      wrappedHandler,
    )

    if (usage.promptTokens === 0 && result && result.promptTokens > 0) {
      usage = {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.promptTokens + result.completionTokens,
      }
    }

    const finishedAt = Date.now()
    context.finishedAt = finishedAt

    const cost = computeCost(usage, request.model)
    context.usage = usage
    context.cost = cost

    recordUsage({
      requestId: context.requestId,
      sessionId: request.sessionId,
      source: request.source,
      kind: request.kind,
      providerProfileId: context.providerProfileId,
      providerId: request.provider.id,
      model: request.model.id,
      primaryProviderId: context.primaryProviderId,
      primaryModel: context.primaryModel,
      fallbackReason: context.fallbackReason,
      fallbackChainId: context.fallbackChainId,
      retryIndex: context.retryIndex,
      startedAt,
      firstTokenAt: context.firstTokenAt,
      finishedAt,
      status: 'success',
      usage,
      cost,
    })

    recordProviderSuccess(request.provider.id)

    endSpan(spanId, 'ok', {
      requestId: context.requestId,
      durationMs: finishedAt - startedAt,
      ttfbMs: context.firstTokenAt ? context.firstTokenAt - startedAt : null,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    })

    log.info('gateway_request_done', {
      requestId: context.requestId,
      durationMs: finishedAt - startedAt,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    })

    return {
      status: 'success',
      content: result?.content || content,
      model: result?.model || request.model.id,
      finishReason: result?.finishReason || finishReason,
      usage,
      cost,
      context,
    }
  } catch (err) {
    const gatewayError = classifyError(err)
    const finishedAt = Date.now()
    context.finishedAt = finishedAt
    context.lastError = gatewayError

    recordUsage({
      requestId: context.requestId,
      sessionId: request.sessionId,
      source: request.source,
      kind: request.kind,
      providerProfileId: context.providerProfileId,
      providerId: request.provider.id,
      model: request.model.id,
      primaryProviderId: context.primaryProviderId,
      primaryModel: context.primaryModel,
      fallbackReason: context.fallbackReason,
      fallbackChainId: context.fallbackChainId,
      retryIndex: context.retryIndex,
      startedAt,
      firstTokenAt: context.firstTokenAt,
      finishedAt,
      status: gatewayError.type === 'cancelled' ? 'cancelled' : 'error',
      error: gatewayError,
    })

    recordProviderFailure(request.provider.id)

    endSpan(spanId, gatewayError.type === 'cancelled' ? 'cancelled' : 'error', {
      requestId: context.requestId,
      errorType: gatewayError.type,
      errorMessage: gatewayError.message,
      retryable: gatewayError.retryable,
    })

    log.warn('gateway_request_error', {
      requestId: context.requestId,
      errorType: gatewayError.type,
      errorMessage: gatewayError.message,
      retryable: gatewayError.retryable,
      retryIndex: context.retryIndex,
    })

    throw gatewayError
  }
}

/**
 * 执行 Gateway 请求（包含限流检查和 Fallback 重试）
 *
 * @param request Gateway 请求参数
 * @param onEvent 流式事件回调
 * @returns Gateway 执行结果
 */
export async function executeGatewayRequest(
  request: AiGatewayRequest,
  onEvent: AiGatewayEventHandler,
): Promise<AiGatewayResult> {
  const requestId = request.requestId ?? generateRequestId()
  const requestStartedAt = Date.now()

  request = applyRequestOverrides(request, requestId)

  let tokenEstimate: TokenEstimateResult
  try {
    tokenEstimate = preflightGatewayRequest(request, requestId)
  } catch (err) {
    const gatewayError = err instanceof AiGatewayError ? err : classifyError(err)
    recordGatewayError({ request, requestId, startedAt: requestStartedAt, error: gatewayError })
    throw gatewayError
  }

  const context = buildContext(request, requestId)
  context.tokenEstimate = tokenEstimate

  const limitResult = consumeQuota(request.provider.id, request.rateLimit)
  if (!limitResult.allowed) {
    log.warn('gateway_rate_limited', { requestId, providerId: request.provider.id })
    const gatewayError = new AiGatewayError(
      'rate_limit',
      `Rate limit exceeded for provider ${request.provider.name}: ${limitResult.currentCount}/${limitResult.remaining + limitResult.currentCount} requests`,
      true,
    )
    recordGatewayError({ request, requestId, startedAt: requestStartedAt, error: gatewayError, context })
    throw gatewayError
  }

  try {
    return await executeSingleRequest(request, onEvent, context)
  } catch (err) {
    const gatewayError = err instanceof AiGatewayError ? err : classifyError(err)

    // 不可重试的错误直接抛出
    if (!gatewayError.retryable || request.signal?.aborted) {
      throw gatewayError
    }

    // 取消错误直接抛出
    if (gatewayError.type === 'cancelled') {
      throw gatewayError
    }

    // 尝试 Fallback chain
    const chain = request.fallbackChain ?? []
    if (chain.length === 0) {
      throw gatewayError
    }

    let lastError = gatewayError
    for (let i = 0; i < chain.length; i++) {
      const candidate = nextFallbackCandidate(chain, i)
      if (!candidate) break

      log.info('gateway_fallback_attempt', {
        requestId,
        fallbackIndex: i,
        reason: candidate.reason,
        provider: candidate.provider.id,
        model: candidate.model.id,
      })

      const fallbackRequest: AiGatewayRequest = {
        ...request,
        provider: candidate.provider,
        model: candidate.model,
        apiKey: request.apiKeysByProvider?.[candidate.provider.id] ?? request.apiKey,
      }
      const fallbackContext = buildContext(fallbackRequest, requestId)
      fallbackContext.retryIndex = i + 1
      fallbackContext.lastError = lastError
      fallbackContext.primaryProviderId = request.provider.id
      fallbackContext.primaryModel = request.model.id
      fallbackContext.fallbackReason = candidate.reason
      fallbackContext.fallbackChainId = `${request.provider.id}->${candidate.provider.id}`

      try {
        const fallbackStartedAt = Date.now()
        try {
          fallbackContext.tokenEstimate = preflightGatewayRequest(fallbackRequest, requestId)
        } catch (preflightErr) {
          const preflightError = preflightErr instanceof AiGatewayError ? preflightErr : classifyError(preflightErr)
          recordGatewayError({
            request: fallbackRequest,
            requestId,
            startedAt: fallbackStartedAt,
            error: preflightError,
            context: fallbackContext,
          })
          throw preflightError
        }

        const fbLimit = consumeQuota(candidate.provider.id, request.rateLimit)
        if (!fbLimit.allowed) {
          const rateLimitError = new AiGatewayError(
            'rate_limit',
            `Rate limit exceeded for fallback provider ${candidate.provider.name}: ${fbLimit.currentCount}/${fbLimit.remaining + fbLimit.currentCount} requests`,
            true,
          )
          recordGatewayError({
            request: fallbackRequest,
            requestId,
            startedAt: fallbackStartedAt,
            error: rateLimitError,
            context: fallbackContext,
          })
          log.warn('gateway_fallback_rate_limited', {
            requestId,
            fallbackProvider: candidate.provider.id,
          })
          continue
        }

        const result = await executeSingleRequest(fallbackRequest, onEvent, fallbackContext)
        log.info('gateway_fallback_success', {
          requestId,
          fallbackIndex: i,
          provider: candidate.provider.id,
        })
        return result
      } catch (fbErr) {
        lastError = fbErr instanceof AiGatewayError ? fbErr : classifyError(fbErr)
        log.warn('gateway_fallback_failed', {
          requestId,
          fallbackIndex: i,
          errorType: lastError.type,
          errorMessage: lastError.message,
        })
      }
    }

    // 所有 fallback 都失败，抛出最后一个错误
    log.error('gateway_all_fallbacks_failed', { requestId, lastErrorType: lastError.type })
    throw lastError
  }
}

/**
 * 取消指定会话的流式请求
 */
export async function abortGatewayRequest(sessionId: string): Promise<boolean> {
  return aiAbortStream(sessionId)
}
