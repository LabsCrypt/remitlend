/**
 * #1523 — soundManagerCore.ts (the actual SoundManager class, including its
 * eager Audio-element setup) must only be dynamically imported after a real
 * sound trigger, not merely because a component called useSoundEffect().
 */

describe("soundManager lazy loading (#1523)", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("does not import soundManagerCore just from calling useSoundEffect()", async () => {
    jest.doMock("./soundManagerCore");
    const core = await import("./soundManagerCore");
    const { useSoundEffect } = await import("./soundManager");

    useSoundEffect();
    // Give any accidental microtask-scheduled import a chance to run.
    await Promise.resolve();
    await Promise.resolve();

    expect(core.SoundManager).not.toHaveBeenCalled();
  });

  it("imports soundManagerCore and constructs it on the first play() call", async () => {
    jest.doMock("./soundManagerCore");
    const core = await import("./soundManagerCore");
    const { useSoundEffect } = await import("./soundManager");

    const sound = useSoundEffect();
    sound.play("click");

    // The import + construction happen asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(core.SoundManager).toHaveBeenCalledTimes(1);
  });

  it("imports soundManagerCore on the first setEnabled() call, not just play()", async () => {
    jest.doMock("./soundManagerCore");
    const core = await import("./soundManagerCore");
    const { useSoundEffect } = await import("./soundManager");

    const sound = useSoundEffect();
    sound.setEnabled(false);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(core.SoundManager).toHaveBeenCalledTimes(1);
  });

  it("only constructs the core manager once across multiple trigger calls", async () => {
    jest.doMock("./soundManagerCore");
    const core = await import("./soundManagerCore");
    const { useSoundEffect } = await import("./soundManager");

    const sound = useSoundEffect();
    sound.play("click");
    sound.play("success");
    sound.setVolume(0.2);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(core.SoundManager).toHaveBeenCalledTimes(1);
  });

  it("queues calls made before the dynamic import resolves and replays them in order", async () => {
    const playMock = jest.fn();
    const setEnabledMock = jest.fn();

    jest.doMock("./soundManagerCore", () => ({
      SoundManager: jest.fn().mockImplementation(() => ({
        play: playMock,
        setEnabled: setEnabledMock,
        setVolume: jest.fn(),
        preload: jest.fn(),
        preloadAll: jest.fn(),
      })),
    }));

    const { useSoundEffect } = await import("./soundManager");
    const sound = useSoundEffect();

    // Fire multiple calls synchronously, before the async import can
    // possibly have resolved.
    sound.setEnabled(true);
    sound.play("levelUp");

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setEnabledMock).toHaveBeenCalledWith(true);
    expect(playMock).toHaveBeenCalledWith("levelUp");
  });
});
