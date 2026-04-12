FROM nginx:1.25-alpine
COPY nginx.prod.conf /etc/nginx/nginx.conf
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
