/**
 * RFC-004: Token 预算溢出错误。
 *
 * 当强制模块之和已超预算，或所有非强制模块降级到 minimal
 * 仍超出预算时抛出。调用层(RFC-005/006/007)应 catch 并返回
 * 结构化错误给前端，而非静默截断。
 */
export class ContextBudgetExceededError extends Error {
  public readonly totalEstimate: number;
  public readonly budget: number;

  constructor(totalEstimate: number, budget: number) {
    super(
      `Context budget exceeded: estimated ${totalEstimate} tokens > ${budget} budget`,
    );
    this.name = 'ContextBudgetExceededError';
    this.totalEstimate = totalEstimate;
    this.budget = budget;
  }
}
