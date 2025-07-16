FROM node:18-alpine

WORKDIR /usr/app

COPY package.json .

RUN yarn install

RUN npm install -g nodemon

COPY . .

EXPOSE 3000

