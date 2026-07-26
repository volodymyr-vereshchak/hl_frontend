# Serves the COMMITTED build — no node in the image and no npm during deploy.
#
# `dist/` is deliberately tracked in this repo (see README, "Деплой"): the
# offline Windows server has no node either, so one build artefact serves both
# targets and there is only ever one thing to keep in sync. The trade-off is
# that `npm run build` must be run and committed before deploying; a src-only
# commit will NOT change what this image serves.
FROM nginx:alpine

COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
