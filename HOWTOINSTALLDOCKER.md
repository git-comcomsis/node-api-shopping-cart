# Guía de Despliegue Remoto con Docker

Esta guía explica cómo instalar y ejecutar la API **Shopping Cart & WMS** en cualquier servidor remoto (VPS, AWS, DigitalOcean, Google Cloud Compute) utilizando Docker y el código fuente alojado en GitHub.

## 📋 Prerrequisitos

Asegúrate de que tu servidor tenga instalado:
1.  **Git**: `sudo apt-get install git`
2.  **Docker**: Guía de instalación oficial
3.  **Docker Compose**: Guía de instalación oficial

## 🚀 Pasos de Instalación

### 1. Clonar el Repositorio
Conéctate a tu servidor vía SSH y descarga el código fuente:

```bash
git clone https://github.com/git-comcomsis/node-api-shopping-cart.git
cd node-api-shopping-cart
```

### 2. Construir y Ejecutar Contenedores
El proyecto incluye un archivo `docker-compose.yml` preconfigurado con una base de datos PostgreSQL y las variables de entorno necesarias para funcionar de inmediato.

Ejecuta el siguiente comando para construir la imagen y levantar los servicios en segundo plano:

```bash
docker-compose up --build -d
```

*   Esto levantará la API en el puerto `14420`.
*   Esto levantará PostgreSQL en el puerto `5432`.

### 3. Inicializar la Base de Datos (Migraciones)
La primera vez que ejecutas el sistema, la base de datos estará vacía. Debes ejecutar el endpoint de migración para crear las tablas.

Ejecuta este comando desde la terminal del servidor (espera unos 10 segundos después de levantar los contenedores para asegurar que la DB esté lista):

```bash
# La API Key por defecto en docker-compose es 'secret-api-key'
curl -H "x-api-key: secret-api-key" http://localhost:14420/migrations
```

Si ves un mensaje de éxito (`Migración completada`), el sistema está listo.

## 🔍 Verificación y Monitoreo

Para verificar que el sistema está corriendo correctamente:

**Ver logs de la API:**
```bash
docker-compose logs -f api
```

**Verificar estado (Health Check):**
```bash
curl http://localhost:14420/
```

## ⚙️ Personalización (Producción)

Si deseas cambiar contraseñas o puertos para un entorno de producción real:

1.  Edita el archivo `docker-compose.yml` usando `nano docker-compose.yml`.
2.  Modifica las variables bajo la sección `environment` (ej. `DB_PASSWORD`, `API_KEY`).
3.  Reinicia los servicios: `docker-compose up -d --force-recreate`.