// O e2e roda dentro do container nestjs-api: as URLs "públicas" assinadas
// precisam apontar para o minio pela rede do compose para o fetch alcançá-las.
process.env.STORAGE_PUBLIC_ENDPOINT = process.env.STORAGE_ENDPOINT;
