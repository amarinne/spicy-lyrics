export type LyricsRequestSession = Readonly<{
  id: number;
  uri: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
}>;

type ActiveRequest<Result> = {
  session: LyricsRequestSession;
  controller: AbortController;
  promise: Promise<Result> | null;
};

export class LyricsRequestCoordinator<Result> {
  private sequence = 0;
  private active: ActiveRequest<Result> | null = null;

  run(uri: string, task: (session: LyricsRequestSession) => Promise<Result>): Promise<Result> {
    if (this.active?.session.uri === uri && this.active.promise && !this.active.session.signal.aborted) return this.active.promise;
    this.invalidate();
    const id = ++this.sequence;
    const controller = new AbortController();
    const session = Object.freeze({
      id,
      uri,
      signal: controller.signal,
      isCurrent: () => this.active?.session.id === id && !controller.signal.aborted,
    });
    const active: ActiveRequest<Result> = { session, controller, promise: null };
    this.active = active;
    const promise = Promise.resolve().then(() => task(session)).finally(() => {
      if (this.active?.session.id === id) this.active.promise = null;
    });
    active.promise = promise;
    return promise;
  }

  invalidate(): void {
    this.active?.controller.abort("invalidated");
    this.active = null;
  }
}
