import app from './locales/app.mjs';
import backend from './locales/backend.mjs';
import workspace from './locales/workspace.mjs';
import mindmapModel from './locales/mindmap-model.mjs';
import feedback from './locales/feedback.mjs';
import { createTranslator } from './i18n-core.mjs';

export { languages } from './i18n-core.mjs';
export const { t, getLocale, setLocale, onLocaleChange } = createTranslator({ ...app, ...backend, ...workspace, ...mindmapModel, ...feedback });
