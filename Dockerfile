# Usamos una imagen base ligera de Node.js
FROM node:18-alpine

# Establecemos el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app/api-shopping-cart

# Copiamos los archivos de definición de dependencias
# Ajustamos la ruta porque el código está en una subcarpeta
COPY api-shopping-cart/package*.json ./

# Instalamos las dependencias (solo producción para optimizar tamaño si fuera necesario, 
# pero aquí instalamos todo para asegurar que funcionen los scripts)
RUN npm install

# Copiamos el resto del código fuente
# Copiamos solo el contenido de la carpeta del proyecto
COPY api-shopping-cart/ .

# Exponemos el puerto que usa la aplicación (según tu .env default)
EXPOSE 14420

# Definimos variables de entorno por defecto (pueden sobreescribirse)
ENV NODE_ENV=production

# Comando para iniciar la aplicación
CMD ["npm", "start"]