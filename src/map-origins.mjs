// An origin belongs to a navigation into a tab, not to a Markdown path or to
// a saved mind map. Two maps (or two nodes) can open the same article.
export function createMapOrigins(hasNode) {
  const origins = new Map();
  return {
    open(articleId, origin) {
      if (origin === null) origins.delete(articleId); // A direct file open.
      else if (origin) origins.set(articleId, origin); // Tab activation carries no origin.
    },
    get(articleId) {
      const origin = origins.get(articleId);
      return origin && hasNode(origin.mapId, origin.nodeId) ? origin : undefined;
    },
    close(id) {
      origins.delete(id);
      for (const [article, origin] of origins) if (origin.mapId === id) origins.delete(article);
    },
  };
}
