## Creando una imagen para el ayudante virtual

[![Build Status](https://travis-ci.com/ayudante-virtual/botpress.svg?branch=master)](https://travis-ci.com/ayudante-virtual/botpress)

1. Instalar las dependencias:

        $ yarn

2. Compilar el proyecto:

        $ yarn build

3. Empaquetar:

        $ yarn package --linux

4. Crear la imagen de Docker:

        $ docker build -f build-av/Dockerfile out/binaries/ -t ayudantevirtual/botpress:version

5. Pushear a Docker Hub:

        $ docker push ayudantevirtual/botpress:version
