export const without = (items: Set<string>, value: string) => {
  const next = new Set(items);
  next.delete(value);
  return next;
};
