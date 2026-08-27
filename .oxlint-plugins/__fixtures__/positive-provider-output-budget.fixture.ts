const accepted = { maxOutputTokens: 1024 };

// oxlint-disable-next-line positive-provider-output-budget/positive-provider-output-budget -- fixture proves non-positive budgets remain rejected
const rejected = { maxOutputTokens: 0 };

void accepted;
void rejected;
