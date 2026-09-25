#!/bin/sh
# Postgres container ilk kez ayaga kalkarken calisir (docker-entrypoint-initdb.d).
# POSTGRES_DB=hr360_operational zaten otomatik olusuyor; burada sadece
# mlflow icin ikinci veritabanini ekliyoruz.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE hr360_mlflow OWNER $POSTGRES_USER;
EOSQL
