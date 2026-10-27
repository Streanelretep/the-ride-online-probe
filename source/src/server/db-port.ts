export interface QueryPort {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, any>[] }>;
}
