// Preload (bunfig.toml) — runs before every test file.
// Manually installs happy-dom globals since bun 1.3.8 does not support
// the `environment` key in bunfig.toml (added in a later release).
// Uses GlobalWindow (not Window) so built-ins like SyntaxError are present
// on the window object — required by happy-dom's querySelectorAll internals.
import { GlobalWindow } from 'happy-dom';

const happyWindow = new GlobalWindow({ url: 'http://localhost:3000/' });

// biome-ignore lint/suspicious/noExplicitAny: DOM polyfill assignment
const g = globalThis as any;
// biome-ignore lint/suspicious/noExplicitAny: DOM polyfill assignment
const w = happyWindow as any;

// Core
g.window = happyWindow;
g.document = happyWindow.document;
g.navigator = happyWindow.navigator;
g.location = happyWindow.location;
g.history = happyWindow.history;
g.screen = happyWindow.screen;
g.getComputedStyle = w.getComputedStyle?.bind(happyWindow);
g.requestAnimationFrame = w.requestAnimationFrame?.bind(happyWindow);
g.cancelAnimationFrame = w.cancelAnimationFrame?.bind(happyWindow);

// DOM constructors
g.Event = w.Event;
g.CustomEvent = w.CustomEvent;
g.EventTarget = w.EventTarget;
g.Node = w.Node;
g.Element = w.Element;
g.HTMLElement = w.HTMLElement;
g.HTMLInputElement = w.HTMLInputElement;
g.HTMLTextAreaElement = w.HTMLTextAreaElement;
g.HTMLButtonElement = w.HTMLButtonElement;
g.HTMLSelectElement = w.HTMLSelectElement;
g.HTMLFormElement = w.HTMLFormElement;
g.MutationObserver = w.MutationObserver;
g.IntersectionObserver = w.IntersectionObserver;
g.ResizeObserver = w.ResizeObserver;
g.Range = w.Range;
g.Text = w.Text;
g.Comment = w.Comment;
g.DocumentFragment = w.DocumentFragment;
g.KeyboardEvent = w.KeyboardEvent;
g.MouseEvent = w.MouseEvent;
g.PointerEvent = w.PointerEvent;
g.FocusEvent = w.FocusEvent;
g.InputEvent = w.InputEvent;
g.UIEvent = w.UIEvent;
g.WheelEvent = w.WheelEvent;
g.Selection = w.Selection;
g.DOMException = w.DOMException;
g.DOMParser = w.DOMParser;
g.CSSStyleDeclaration = w.CSSStyleDeclaration;
g.SVGElement = w.SVGElement;
