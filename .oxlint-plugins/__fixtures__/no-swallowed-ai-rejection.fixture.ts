const handled = Promise.reject(new Error("fixture")).catch((error) => {
  console.warn(error.name);
});

// oxlint-disable-next-line no-swallowed-ai-rejection/no-swallowed-ai-rejection -- fixture proves empty rejection handlers remain rejected
const swallowed = Promise.reject(new Error("fixture")).catch(() => undefined);

void handled;
void swallowed;
